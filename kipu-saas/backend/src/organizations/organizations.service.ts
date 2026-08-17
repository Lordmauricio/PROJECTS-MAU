import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, type Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  DEFAULT_ROLE_KEYS,
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
} from '../permissions/permissions.catalog';
import { CASH_INCREASE_TYPES, CASH_DECREASE_TYPES } from '../cash/cash.service';
import { money } from '../common/money';
import { ReportsService } from '../reports/reports.service';

export interface BootstrapOrganizationInput {
  organizationName: string;
  legalName: string;
  nit: string;
  branchName: string;
  ownerEmail: string;
  ownerName: string;
  ownerPasswordHash: string;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * Crea una organización nueva con: sucursal principal, su almacén y punto
   * de venta principales (jerarquía Empresa -> Sucursal -> Almacén / Punto
   * de Venta), roles por defecto (clonados del catálogo global de
   * permisos), plan gratuito de suscripción, y la membresía del usuario
   * dueño con rol OWNER. Todo en una sola transacción.
   *
   * Nota sobre RLS: `organizations` valida sus propias filas contra su
   * propio `id` (es la raíz del árbol de tenancy), así que hay que fijar
   * `app.current_tenant` a un id generado ANTES del INSERT para que la
   * policy `WITH CHECK` lo acepte. Las demás tablas se validan contra
   * `organizationId`, que ya conocemos en este punto.
   *
   * El usuario dueño se crea DENTRO de esta misma transacción (la tabla
   * `users` no tiene RLS): si cualquier paso posterior falla, toda la
   * operación revierte, incluido el usuario — evita cuentas huérfanas.
   */
  async bootstrapOrganization(input: BootstrapOrganizationInput) {
    const organizationId = randomUUID();

    return this.tenantPrisma.run(organizationId, async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: organizationId,
          name: input.organizationName,
          legalName: input.legalName,
          nit: input.nit,
        },
      });

      const roles = await this.seedDefaultRoles(tx, organizationId);

      const branch = await tx.branch.create({
        data: {
          organizationId,
          name: input.branchName,
          isMainOffice: true,
        },
      });

      const warehouse = await tx.warehouse.create({
        data: {
          organizationId,
          branchId: branch.id,
          name: `Almacén principal — ${input.branchName}`,
        },
      });

      const posTerminal = await tx.pOSTerminal.create({
        data: {
          organizationId,
          branchId: branch.id,
          name: `Caja principal — ${input.branchName}`,
          code: 'POS-01',
        },
      });

      const freePlan = await this.getOrCreateFreePlan();
      await tx.subscription.create({
        data: { organizationId, planId: freePlan.id, status: 'TRIALING' },
      });

      const user = await tx.user.create({
        data: {
          email: input.ownerEmail,
          name: input.ownerName,
          passwordHash: input.ownerPasswordHash,
        },
      });

      const ownerRole = roles.find((r) => r.key === 'OWNER')!;

      const membership = await tx.organizationUser.create({
        data: {
          organizationId,
          userId: user.id,
          roleId: ownerRole.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      return {
        organization,
        branch,
        warehouse,
        posTerminal,
        membership,
        roles,
        user,
      };
    });
  }

  private async seedDefaultRoles(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    const allPermissions = await this.prisma.permission.findMany();
    const permissionByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    const roles: Role[] = [];
    for (const roleKey of DEFAULT_ROLE_KEYS) {
      const role = await tx.role.create({
        data: {
          organizationId,
          key: roleKey,
          name: DEFAULT_ROLE_NAMES[roleKey],
          isSystem: true,
        },
      });

      const grantedKeys = [...new Set(DEFAULT_ROLE_PERMISSIONS[roleKey])];
      const data = grantedKeys
        .map((key) => permissionByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({
          organizationId,
          roleId: role.id,
          permissionId,
        }));

      if (data.length > 0) {
        await tx.rolePermission.createMany({ data });
      }

      roles.push(role);
    }
    return roles;
  }

  private async getOrCreateFreePlan() {
    const existing = await this.prisma.plan.findUnique({
      where: { key: 'free' },
    });
    if (existing) return existing;
    return this.prisma.plan.create({
      data: {
        key: 'free',
        name: 'Gratis',
        priceMonthly: 0,
        limits: { maxUsers: 3, maxBranches: 1, maxProducts: 50 },
        features: { pos: true, inventory: true, invoicing: false },
      },
    });
  }

  async findById(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    );
  }

  async getSubscription(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.subscription.findUniqueOrThrow({
        where: { organizationId },
        include: { plan: true },
      }),
    );
  }

  /**
   * Métricas reales para el dashboard (sección 9 del prompt, ampliado en la
   * Fase Comercial 7 con compras/ingresos/egresos/cuentas por
   * pagar/inventario/productos más vendidos — sección "DASHBOARD" de ese
   * pedido). Todo se lee directo de las tablas ya existentes (o vía
   * `ReportsService`, nunca reimplementando su agregación) — si no hay
   * actividad real todavía, los números dan 0 legítimamente, nunca datos
   * de ejemplo.
   *
   * `status: { in: [...] }` en Sale/Purchase reemplaza el filtro original
   * de Fase 1 (`status: 'CONFIRMED'` a secas, escrito antes de que Ventas
   * tuviera su propia máquina de estados) — una venta pagada pasa a
   * `PARTIALLY_PAID`/`PAID` y quedaba FUERA de "ventas del día/mes" con el
   * filtro viejo, subcontando sistemáticamente. Se excluye `REFUNDED`
   * deliberadamente: ese dinero ya se devolvió, no es ingreso neto del
   * período. `CANCELLED`/`DRAFT` nunca cuentan como venta real.
   */
  async getDashboardSummary(organizationId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(
      startOfDay.getFullYear(),
      startOfDay.getMonth(),
      1,
    );
    const REAL_SALE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as const;
    const REAL_PURCHASE_STATUSES = [
      'CONFIRMED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
    ] as const;

    const [dashboardData, topProducts] = await Promise.all([
      this.tenantPrisma.run(organizationId, async (tx) => {
        const [
          salesToday,
          salesMonth,
          purchasesMonth,
          invoicesIssued,
          customersCount,
          productsCount,
          lowStockCount,
          pendingReceivables,
          pendingPayables,
          cashMovementsMonth,
          stockValue,
        ] = await Promise.all([
          tx.sale.aggregate({
            where: {
              organizationId,
              status: { in: [...REAL_SALE_STATUSES] },
              createdAt: { gte: startOfDay },
            },
            _sum: { total: true },
            _count: true,
          }),
          tx.sale.aggregate({
            where: {
              organizationId,
              status: { in: [...REAL_SALE_STATUSES] },
              createdAt: { gte: startOfMonth },
            },
            _sum: { total: true },
            _count: true,
          }),
          tx.purchase.aggregate({
            where: {
              organizationId,
              status: { in: [...REAL_PURCHASE_STATUSES] },
              createdAt: { gte: startOfMonth },
            },
            _sum: { total: true },
            _count: true,
          }),
          tx.invoice.count({ where: { organizationId, status: 'VALID' } }),
          tx.customer.count({ where: { organizationId, active: true } }),
          tx.product.count({ where: { organizationId, active: true } }),
          tx.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM inventories i JOIN products p ON p."id" = i."productId" WHERE p."organizationId" = ${organizationId} AND i.quantity <= p."minStock"`,
          tx.receivable.aggregate({
            where: { organizationId, status: { in: ['PENDING', 'OVERDUE'] } },
            _sum: { amount: true },
            _count: true,
          }),
          tx.payable.aggregate({
            where: { organizationId, status: { in: ['PENDING', 'OVERDUE'] } },
            _sum: { amount: true },
            _count: true,
          }),
          tx.cashMovement.groupBy({
            by: ['type'],
            where: { organizationId, createdAt: { gte: startOfMonth } },
            _sum: { amount: true },
          }),
          tx.$queryRaw<
            { value: Prisma.Decimal | null }[]
          >`SELECT SUM(i.quantity * p.cost) AS value FROM inventories i JOIN products p ON p."id" = i."productId" WHERE p."organizationId" = ${organizationId}`,
        ]);

        let income = money(0);
        let expenses = money(0);
        for (const m of cashMovementsMonth) {
          const amount = money(m._sum.amount ?? 0);
          if (CASH_INCREASE_TYPES.has(m.type)) income = income.add(amount);
          else if (CASH_DECREASE_TYPES.has(m.type))
            expenses = expenses.add(amount);
        }

        return {
          salesToday: {
            count: salesToday._count,
            total: salesToday._sum.total ?? 0,
          },
          salesMonth: {
            count: salesMonth._count,
            total: salesMonth._sum.total ?? 0,
          },
          purchasesMonth: {
            count: purchasesMonth._count,
            total: purchasesMonth._sum.total ?? 0,
          },
          incomeMonth: income,
          expensesMonth: expenses,
          invoicesIssued,
          customersServed: customersCount,
          productsActive: productsCount,
          lowStockProducts: Number(lowStockCount[0]?.count ?? 0),
          pendingReceivables: {
            count: pendingReceivables._count,
            total: pendingReceivables._sum.amount ?? 0,
          },
          pendingPayables: {
            count: pendingPayables._count,
            total: pendingPayables._sum.amount ?? 0,
          },
          stockValue: stockValue[0]?.value ?? 0,
        };
      }),
      this.reports.topProductsReport(organizationId, {
        dateFrom: startOfMonth.toISOString(),
        limit: 5,
      }),
    ]);

    return {
      ...dashboardData,
      topProducts: topProducts.rows,
      // Utilidad comercial (ventas - costo de lo vendido) NO se calcula:
      // `SaleItem` no persiste el costo unitario al momento de la venta (a
      // diferencia de `PurchaseItem.unitCost`, que sí es histórico) y no
      // hay trazabilidad de lote/FIFO que ligue una venta a la compra que
      // la abasteció. Usar `Product.cost` ACTUAL para aproximar el costo
      // de ventas pasadas daría una cifra incorrecta para cualquier
      // producto cuyo costo cambió desde entonces — se prefiere no
      // mostrar nada antes que mostrar una utilidad que puede estar mal.
      grossMargin: {
        available: false,
        reason:
          'No hay costo histórico por línea de venta (SaleItem no lo persiste) — calcularlo con el costo actual del producto podría dar una cifra incorrecta.',
      },
    };
  }
}
