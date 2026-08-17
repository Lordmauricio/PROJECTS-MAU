import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type SaleStatus } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CASH_INCREASE_TYPES, CASH_DECREASE_TYPES } from '../cash/cash.service';
import { money, sumMoney, ZERO_MONEY } from '../common/money';
import { ReportQueryDto } from './dto/report-query.dto';

type Tx = Prisma.TransactionClient;

const SALE_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REFUNDED',
] as const;
const PURCHASE_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
const RECEIVABLE_PAYABLE_STATUSES = [
  'PENDING',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;
const CASH_REGISTER_STATUSES = ['OPEN', 'CLOSED'] as const;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
/** Techo de filas devueltas por un export — evita cargar un dataset ilimitado en memoria (sección RENDIMIENTO del pedido). */
export const REPORT_EXPORT_MAX_ROWS = 20_000;
const DEFAULT_TOP_LIMIT = 10;
const MAX_LIMIT = 500;

function assertStatus<T extends readonly string[]>(
  value: string | undefined,
  valid: T,
  label: string,
): T[number] | undefined {
  if (value === undefined) return undefined;
  if (!(valid as readonly string[]).includes(value)) {
    throw new BadRequestException(
      `Estado inválido para ${label}: "${value}" (válidos: ${valid.join(', ')})`,
    );
  }
  return value;
}

/**
 * Vista en pantalla: sin `pageSize` explícito, pagina de a
 * `DEFAULT_PAGE_SIZE` (20), tope `MAX_PAGE_SIZE` (100). Export: se le pasa
 * `maxPageSize: REPORT_EXPORT_MAX_ROWS` — sin `pageSize` explícito, trae
 * TODO hasta ese tope (no solo 20), porque exportar significa "todo lo que
 * matchea el filtro", no "la primera página". Mismo `where` en ambos casos
 * — nunca una consulta separada — así que exportar nunca puede mostrar
 * cifras distintas a las que ya se ven paginadas en pantalla.
 */
function pageInfo(filters: ReportQueryDto, opts?: { maxPageSize?: number }) {
  const maxPageSize = opts?.maxPageSize ?? MAX_PAGE_SIZE;
  const defaultPageSize = opts?.maxPageSize ?? DEFAULT_PAGE_SIZE;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = Math.min(filters.pageSize ?? defaultPageSize, maxPageSize);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function dateRange(filters: ReportQueryDto) {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  return {
    ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
    ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
  };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // -----------------------------------------------------------------------
  // Resolución de alcance por sucursal: Sale/Purchase no tienen `branchId`
  // directo (solo `warehouseId`/`posTerminalId`), así que "ventas/compras de
  // la sucursal X" se resuelve consultando qué almacenes/puntos de venta de
  // ESTE tenant pertenecen a esa sucursal. Si `branchId` es de otro tenant o
  // no existe, ambas listas quedan vacías y el filtro adelante devuelve
  // cero filas (nunca datos de otro tenant) — ver `reports.security.spec.ts`.
  // -----------------------------------------------------------------------
  private async resolveBranchScope(
    tx: Tx,
    organizationId: string,
    branchId: string | undefined,
  ): Promise<{ warehouseIds?: string[]; posTerminalIds?: string[] }> {
    if (!branchId) return {};
    const [warehouses, posTerminals] = await Promise.all([
      tx.warehouse.findMany({
        where: { organizationId, branchId },
        select: { id: true },
      }),
      tx.pOSTerminal.findMany({
        where: { organizationId, branchId },
        select: { id: true },
      }),
    ]);
    return {
      warehouseIds: warehouses.map((w) => w.id),
      posTerminalIds: posTerminals.map((p) => p.id),
    };
  }

  /** Nombres de usuario (tabla global `users`) para los `createdById` de un conjunto de filas ya tenant-scoped — nunca se usa para BUSCAR por tenant, solo para etiquetar ids que ya vinieron de una consulta filtrada por organizationId. */
  private async userNamesMap(
    tx: Tx,
    organizationId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const memberships = await tx.organizationUser.findMany({
      where: { organizationId, userId: { in: ids } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return new Map(memberships.map((m) => [m.userId, m.user.name]));
  }

  // =========================================================================
  // 1) Reporte de ventas
  // =========================================================================
  async salesReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const status = assertStatus(filters.status, SALE_STATUSES, 'ventas');
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        status,
      );
      const { page, pageSize, skip, take } = pageInfo(filters, opts);

      const [rows, totalRows, agg] = await Promise.all([
        tx.sale.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true } },
            warehouse: { select: { id: true, name: true } },
            posTerminal: { select: { id: true, name: true } },
            _count: { select: { items: true, payments: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        tx.sale.count({ where }),
        tx.sale.aggregate({
          where,
          _sum: { subtotal: true, discount: true, total: true },
          _count: true,
        }),
      ]);

      return {
        rows,
        page,
        pageSize,
        totalRows,
        summary: {
          count: agg._count,
          subtotal: money(agg._sum.subtotal ?? 0),
          discount: money(agg._sum.discount ?? 0),
          total: money(agg._sum.total ?? 0),
        },
      };
    });
  }

  private async buildSalesWhere(
    tx: Tx,
    organizationId: string,
    filters: ReportQueryDto,
    status: SaleStatus | undefined,
  ): Promise<Prisma.SaleWhereInput> {
    const scope = await this.resolveBranchScope(
      tx,
      organizationId,
      filters.branchId,
    );
    const branchFilter = filters.branchId
      ? {
          OR: [
            { warehouseId: { in: scope.warehouseIds ?? [] } },
            { posTerminalId: { in: scope.posTerminalIds ?? [] } },
          ],
        }
      : {};
    return {
      organizationId,
      type: 'SALE',
      ...(status ? { status } : {}),
      ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
      ...(filters.posTerminalId
        ? { posTerminalId: filters.posTerminalId }
        : {}),
      ...(filters.userId ? { createdById: filters.userId } : {}),
      ...(filters.productId
        ? { items: { some: { productId: filters.productId } } }
        : {}),
      ...(filters.categoryId
        ? { items: { some: { product: { categoryId: filters.categoryId } } } }
        : {}),
      ...(filters.paymentMethod
        ? { payments: { some: { method: filters.paymentMethod } } }
        : {}),
      ...(dateRange(filters) ? { createdAt: dateRange(filters) } : {}),
      ...branchFilter,
    };
  }

  // =========================================================================
  // 2) Reporte de compras
  // =========================================================================
  async purchasesReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const status = assertStatus(filters.status, PURCHASE_STATUSES, 'compras');
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const scope = await this.resolveBranchScope(
        tx,
        organizationId,
        filters.branchId,
      );
      const where: Prisma.PurchaseWhereInput = {
        organizationId,
        ...(status ? { status } : {}),
        ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
        ...(filters.userId ? { createdById: filters.userId } : {}),
        ...(filters.productId
          ? { items: { some: { productId: filters.productId } } }
          : {}),
        ...(filters.categoryId
          ? { items: { some: { product: { categoryId: filters.categoryId } } } }
          : {}),
        ...(dateRange(filters) ? { createdAt: dateRange(filters) } : {}),
        ...(filters.branchId
          ? { warehouseId: { in: scope.warehouseIds ?? [] } }
          : {}),
      };
      const { page, pageSize, skip, take } = pageInfo(filters, opts);

      const [rows, totalRows, agg] = await Promise.all([
        tx.purchase.findMany({
          where,
          include: {
            supplier: { select: { id: true, name: true } },
            warehouse: { select: { id: true, name: true } },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        tx.purchase.count({ where }),
        tx.purchase.aggregate({
          where,
          _sum: { subtotal: true, discount: true, total: true },
          _count: true,
        }),
      ]);

      return {
        rows,
        page,
        pageSize,
        totalRows,
        summary: {
          count: agg._count,
          subtotal: money(agg._sum.subtotal ?? 0),
          discount: money(agg._sum.discount ?? 0),
          total: money(agg._sum.total ?? 0),
        },
      };
    });
  }

  // =========================================================================
  // 3) Reporte de ingresos / 4) Reporte de egresos
  // Ambos leen el mismo ledger (`CashMovement`), clasificado por los
  // mismos conjuntos que ya usa `CashService.computeBalance` — nunca se
  // reinventa acá qué tipo suma o resta.
  // =========================================================================
  async incomeReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    return this.cashMovementReport(
      organizationId,
      filters,
      [...CASH_INCREASE_TYPES],
      opts,
    );
  }

  async expensesReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    return this.cashMovementReport(
      organizationId,
      filters,
      [...CASH_DECREASE_TYPES],
      opts,
    );
  }

  private async cashMovementReport(
    organizationId: string,
    filters: ReportQueryDto,
    types: string[],
    opts?: { maxPageSize?: number },
  ) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const registerIds = await this.resolveCashRegisterScope(
        tx,
        organizationId,
        filters,
      );
      const where: Prisma.CashMovementWhereInput = {
        organizationId,
        type: { in: types },
        ...(registerIds ? { cashRegisterId: { in: registerIds } } : {}),
        ...(filters.userId ? { createdById: filters.userId } : {}),
        ...(dateRange(filters) ? { createdAt: dateRange(filters) } : {}),
      };
      const { page, pageSize, skip, take } = pageInfo(filters, opts);

      const [rows, totalRows, agg, byType] = await Promise.all([
        tx.cashMovement.findMany({
          where,
          include: {
            cashRegister: {
              select: {
                id: true,
                posTerminal: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        tx.cashMovement.count({ where }),
        tx.cashMovement.aggregate({
          where,
          _sum: { amount: true },
          _count: true,
        }),
        tx.cashMovement.groupBy({
          by: ['type'],
          where,
          _sum: { amount: true },
          _count: true,
        }),
      ]);

      return {
        rows,
        page,
        pageSize,
        totalRows,
        summary: {
          count: agg._count,
          total: money(agg._sum.amount ?? 0),
          byType: byType.map((t) => ({
            type: t.type,
            count: t._count,
            total: money(t._sum.amount ?? 0),
          })),
        },
      };
    });
  }

  /** Ids de CashRegister que matchean posTerminalId/sucursal, o `undefined` si no hay ningún filtro de alcance (sin restringir). */
  private async resolveCashRegisterScope(
    tx: Tx,
    organizationId: string,
    filters: ReportQueryDto,
  ): Promise<string[] | undefined> {
    if (!filters.posTerminalId && !filters.branchId) return undefined;
    const scope = await this.resolveBranchScope(
      tx,
      organizationId,
      filters.branchId,
    );
    const posTerminalIds = filters.posTerminalId
      ? [filters.posTerminalId]
      : (scope.posTerminalIds ?? []);
    if (posTerminalIds.length === 0) return [];
    const registers = await tx.cashRegister.findMany({
      where: { organizationId, posTerminalId: { in: posTerminalIds } },
      select: { id: true },
    });
    return registers.map((r) => r.id);
  }

  // =========================================================================
  // 5) Reporte de caja: por CashRegister, saldo actual (OPEN) o cierre
  // (CLOSED) — mismo cálculo que `CashService.computeBalance`
  // (openingAmount + incrementos - decrementos), vectorizado para muchas
  // cajas a la vez en vez de N llamadas al método privado.
  // =========================================================================
  async cashReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const status = assertStatus(filters.status, CASH_REGISTER_STATUSES, 'caja');
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const scope = await this.resolveBranchScope(
        tx,
        organizationId,
        filters.branchId,
      );
      const where: Prisma.CashRegisterWhereInput = {
        organizationId,
        ...(status ? { status } : {}),
        ...(filters.posTerminalId
          ? { posTerminalId: filters.posTerminalId }
          : {}),
        ...(filters.branchId
          ? { posTerminalId: { in: scope.posTerminalIds ?? [] } }
          : {}),
        ...(dateRange(filters) ? { openedAt: dateRange(filters) } : {}),
      };
      const { page, pageSize, skip, take } = pageInfo(filters, opts);

      const [registers, totalRows] = await Promise.all([
        tx.cashRegister.findMany({
          where,
          include: { posTerminal: { select: { id: true, name: true } } },
          orderBy: { openedAt: 'desc' },
          skip,
          take,
        }),
        tx.cashRegister.count({ where }),
      ]);

      const registerIds = registers.map((r) => r.id);
      const movementSums =
        registerIds.length > 0
          ? await tx.cashMovement.groupBy({
              by: ['cashRegisterId', 'type'],
              where: { organizationId, cashRegisterId: { in: registerIds } },
              _sum: { amount: true },
            })
          : [];
      const sumsByRegister = new Map<string, Prisma.Decimal>();
      for (const s of movementSums) {
        const prev = sumsByRegister.get(s.cashRegisterId) ?? ZERO_MONEY;
        const amount = money(s._sum.amount ?? 0);
        const signed = CASH_INCREASE_TYPES.has(s.type)
          ? amount
          : CASH_DECREASE_TYPES.has(s.type)
            ? amount.neg()
            : ZERO_MONEY;
        sumsByRegister.set(s.cashRegisterId, prev.add(signed));
      }

      const rows = registers.map((r) => ({
        ...r,
        currentBalance: money(r.openingAmount).add(
          sumsByRegister.get(r.id) ?? ZERO_MONEY,
        ),
      }));

      const totalOpening = sumMoney(registers.map((r) => r.openingAmount));
      const totalCurrentBalance = sumMoney(rows.map((r) => r.currentBalance));
      const totalDifference = sumMoney(
        registers
          .filter((r) => r.difference !== null)
          .map((r) => r.difference!),
      );

      return {
        rows,
        page,
        pageSize,
        totalRows,
        summary: {
          count: registers.length,
          openingAmount: totalOpening,
          currentBalance: totalCurrentBalance,
          closedDifference: totalDifference,
          openCount: registers.filter((r) => r.status === 'OPEN').length,
          closedCount: registers.filter((r) => r.status === 'CLOSED').length,
        },
      };
    });
  }

  // =========================================================================
  // 6) Reporte de inventario — reutiliza InventoryService.listStock (mismo
  // motor de stock, sin reimplementarlo), agrega valorización (quantity *
  // Product.cost, dato ya persistido, no recalculado).
  // =========================================================================
  async inventoryReport(organizationId: string, filters: ReportQueryDto) {
    const rows = await this.inventory.listStock(organizationId, {
      warehouseId: filters.warehouseId,
      productId: filters.productId,
    });
    return this.tenantPrisma.run(organizationId, async (tx) => {
      let scoped = rows as Array<
        (typeof rows)[number] & { product: { cost?: Prisma.Decimal } }
      >;
      if (filters.categoryId || filters.branchId) {
        const productIds = [...new Set(scoped.map((r) => r.productId))];
        const products = await tx.product.findMany({
          where: { organizationId, id: { in: productIds } },
          select: { id: true, categoryId: true, cost: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        if (filters.categoryId) {
          scoped = scoped.filter(
            (r) => byId.get(r.productId)?.categoryId === filters.categoryId,
          );
        }
        if (filters.branchId) {
          const scope = await this.resolveBranchScope(
            tx,
            organizationId,
            filters.branchId,
          );
          const allowed = new Set(scope.warehouseIds ?? []);
          scoped = scoped.filter((r) => allowed.has(r.warehouseId));
        }
      }
      // Valorización: costo actual del producto (no hay costo histórico por
      // unidad en Inventory) — se documenta como valorización AL COSTO
      // ACTUAL, no como costo promedio ponderado ni FIFO.
      const productIds = [...new Set(scoped.map((r) => r.productId))];
      const products = await tx.product.findMany({
        where: { organizationId, id: { in: productIds } },
        select: { id: true, cost: true, minStock: true },
      });
      const costById = new Map(products.map((p) => [p.id, p.cost]));
      const minStockById = new Map(products.map((p) => [p.id, p.minStock]));

      const valuedRows = scoped.map((r) => {
        const cost = costById.get(r.productId) ?? ZERO_MONEY;
        return {
          ...r,
          unitCost: money(cost),
          value: money(money(r.quantity).mul(cost)),
          lowStock: money(r.quantity).lte(
            money(minStockById.get(r.productId) ?? 0),
          ),
        };
      });

      const totalValue = sumMoney(valuedRows.map((r) => r.value));
      const totalQuantity = valuedRows.reduce(
        (acc, r) => acc.add(money(r.quantity)),
        ZERO_MONEY,
      );

      return {
        rows: valuedRows,
        summary: {
          count: valuedRows.length,
          totalQuantity,
          totalValue,
          lowStockCount: valuedRows.filter((r) => r.lowStock).length,
        },
      };
    });
  }

  // =========================================================================
  // 7) Kardex / resumen de movimientos — reutiliza
  // InventoryService.listMovements (mismo motor, mismo paginado).
  // =========================================================================
  async movementsReport(organizationId: string, filters: ReportQueryDto) {
    const rows = await this.inventory.listMovements(organizationId, {
      warehouseId: filters.warehouseId,
      productId: filters.productId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      page: filters.page,
      pageSize: filters.pageSize,
    });
    const summary = {
      count: rows.length,
      in: rows.filter((r) => r.type === 'IN').length,
      out: rows.filter((r) => r.type === 'OUT').length,
      transfer: rows.filter((r) => r.type === 'TRANSFER').length,
      adjustment: rows.filter((r) => r.type === 'ADJUSTMENT').length,
      return: rows.filter((r) => r.type === 'RETURN').length,
    };
    return {
      rows,
      summary,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 50,
    };
  }

  // =========================================================================
  // 8) Cuentas por cobrar / 9) Cuentas por pagar
  // =========================================================================
  async receivablesReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const status = assertStatus(
      filters.status,
      RECEIVABLE_PAYABLE_STATUSES,
      'cuentas por cobrar',
    );
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where: Prisma.ReceivableWhereInput = {
        organizationId,
        ...(status ? { status } : {}),
        ...(dateRange(filters) ? { dueDate: dateRange(filters) } : {}),
      };
      const { page, pageSize, skip, take } = pageInfo(filters, opts);
      const [found, totalRows] = await Promise.all([
        tx.receivable.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true } },
            sale: { include: { payments: { select: { amount: true } } } },
          },
          orderBy: { dueDate: 'asc' },
          skip,
          take,
        }),
        tx.receivable.count({ where }),
      ]);
      const rows = found.map((r) => {
        const paidTotal = sumMoney(
          (r.sale?.payments ?? []).map((p) => p.amount),
        );
        return {
          ...r,
          paidTotal,
          balance: money(r.amount).sub(paidTotal),
        };
      });
      const agg = await tx.receivable.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      });
      return {
        rows,
        page,
        pageSize,
        totalRows,
        summary: {
          count: agg._count,
          amount: money(agg._sum.amount ?? 0),
          balance: sumMoney(rows.map((r) => r.balance)),
        },
      };
    });
  }

  async payablesReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const status = assertStatus(
      filters.status,
      RECEIVABLE_PAYABLE_STATUSES,
      'cuentas por pagar',
    );
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where: Prisma.PayableWhereInput = {
        organizationId,
        ...(status ? { status } : {}),
        ...(dateRange(filters) ? { dueDate: dateRange(filters) } : {}),
      };
      const { page, pageSize, skip, take } = pageInfo(filters, opts);
      const [found, totalRows] = await Promise.all([
        tx.payable.findMany({
          where,
          include: {
            supplier: { select: { id: true, name: true } },
            payments: { select: { amount: true } },
          },
          orderBy: { dueDate: 'asc' },
          skip,
          take,
        }),
        tx.payable.count({ where }),
      ]);
      const rows = found.map((p) => {
        const paidTotal = sumMoney(p.payments.map((pay) => pay.amount));
        return { ...p, paidTotal, balance: money(p.amount).sub(paidTotal) };
      });
      const agg = await tx.payable.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      });
      return {
        rows,
        page,
        pageSize,
        totalRows,
        summary: {
          count: agg._count,
          amount: money(agg._sum.amount ?? 0),
          balance: sumMoney(rows.map((r) => r.balance)),
        },
      };
    });
  }

  // =========================================================================
  // 10) Productos más vendidos / 11) Ventas por producto
  // Mismo groupBy; "más vendidos" es el mismo reporte ordenado desc con un
  // límite chico por defecto, para no duplicar la agregación dos veces.
  // =========================================================================
  async topProductsReport(organizationId: string, filters: ReportQueryDto) {
    return this.salesByProductReport(
      organizationId,
      filters,
      filters.limit ?? DEFAULT_TOP_LIMIT,
    );
  }

  async salesByProductReport(
    organizationId: string,
    filters: ReportQueryDto,
    limitOverride?: number,
  ) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        undefined,
      );
      const limit = Math.min(
        limitOverride ?? filters.limit ?? MAX_LIMIT,
        MAX_LIMIT,
      );

      const grouped = await tx.saleItem.groupBy({
        by: ['productId'],
        where: { organizationId, sale: where },
        _sum: { quantity: true, subtotal: true },
        _count: true,
        orderBy: { _sum: { subtotal: 'desc' } },
        take: limit,
      });
      const productIds = grouped.map((g) => g.productId);
      const products = await tx.product.findMany({
        where: { organizationId, id: { in: productIds } },
        select: { id: true, name: true, sku: true, categoryId: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      const rows = grouped.map((g) => ({
        productId: g.productId,
        product: byId.get(g.productId) ?? null,
        quantity: money(g._sum.quantity ?? 0),
        total: money(g._sum.subtotal ?? 0),
        salesCount: g._count,
      }));

      return {
        rows,
        summary: {
          products: rows.length,
          quantity: sumMoney(rows.map((r) => r.quantity)),
          total: sumMoney(rows.map((r) => r.total)),
        },
      };
    });
  }

  // =========================================================================
  // 12) Ventas por categoría — join SaleItem -> Product -> ProductCategory
  // vía SQL crudo (Prisma `groupBy` no cruza relaciones); sigue corriendo
  // dentro del `tx` de `TenantPrismaService`, protegido por RLS igual que
  // cualquier otra query.
  // =========================================================================
  async salesByCategoryReport(organizationId: string, filters: ReportQueryDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        undefined,
      );
      const saleIds = await tx.sale.findMany({ where, select: { id: true } });
      const ids = saleIds.map((s) => s.id);
      if (ids.length === 0) {
        return {
          rows: [],
          summary: { categories: 0, quantity: ZERO_MONEY, total: ZERO_MONEY },
        };
      }
      const rows = await tx.$queryRaw<
        Array<{
          categoryId: string | null;
          categoryName: string | null;
          quantity: Prisma.Decimal;
          total: Prisma.Decimal;
          salesCount: bigint;
        }>
      >`
        SELECT p."categoryId" AS "categoryId", cat.name AS "categoryName",
               SUM(si.quantity) AS quantity, SUM(si.subtotal) AS total,
               COUNT(DISTINCT si."saleId") AS "salesCount"
        FROM sale_items si
        JOIN products p ON p.id = si."productId"
        LEFT JOIN product_categories cat ON cat.id = p."categoryId"
        WHERE si."organizationId" = ${organizationId}
          AND si."saleId" IN (${Prisma.join(ids)})
        GROUP BY p."categoryId", cat.name
        ORDER BY total DESC
      `;
      const normalized = rows.map((r) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryName ?? 'Sin categoría',
        quantity: money(r.quantity),
        total: money(r.total),
        salesCount: Number(r.salesCount),
      }));
      return {
        rows: normalized,
        summary: {
          categories: normalized.length,
          quantity: sumMoney(normalized.map((r) => r.quantity)),
          total: sumMoney(normalized.map((r) => r.total)),
        },
      };
    });
  }

  // =========================================================================
  // 13) Ventas por sucursal
  // =========================================================================
  async salesByBranchReport(organizationId: string, filters: ReportQueryDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        undefined,
      );
      const sales = await tx.sale.findMany({
        where,
        select: {
          id: true,
          total: true,
          warehouse: { select: { branchId: true } },
          posTerminal: { select: { branchId: true } },
        },
      });
      const branchIds = [
        ...new Set(
          sales
            .map((s) => s.posTerminal?.branchId ?? s.warehouse?.branchId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const branches = await tx.branch.findMany({
        where: { organizationId, id: { in: branchIds } },
        select: { id: true, name: true },
      });
      const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

      const totalsByBranch = new Map<
        string,
        { total: Prisma.Decimal; count: number }
      >();
      for (const s of sales) {
        const branchId =
          s.posTerminal?.branchId ?? s.warehouse?.branchId ?? 'sin-sucursal';
        const prev = totalsByBranch.get(branchId) ?? {
          total: ZERO_MONEY,
          count: 0,
        };
        totalsByBranch.set(branchId, {
          total: prev.total.add(s.total),
          count: prev.count + 1,
        });
      }
      const rows = [...totalsByBranch.entries()]
        .map(([branchId, v]) => ({
          branchId,
          branchName: branchNameById.get(branchId) ?? 'Sin sucursal',
          total: money(v.total),
          salesCount: v.count,
        }))
        .sort((a, b) => Number(b.total.sub(a.total)));

      return {
        rows,
        summary: {
          branches: rows.length,
          total: sumMoney(rows.map((r) => r.total)),
          salesCount: sales.length,
        },
      };
    });
  }

  // =========================================================================
  // 14) Ventas por POS
  // =========================================================================
  async salesByPosReport(organizationId: string, filters: ReportQueryDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        undefined,
      );
      const grouped = await tx.sale.groupBy({
        by: ['posTerminalId'],
        where,
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: 'desc' } },
      });
      const posIds = grouped
        .map((g) => g.posTerminalId)
        .filter((id): id is string => Boolean(id));
      const terminals = await tx.pOSTerminal.findMany({
        where: { organizationId, id: { in: posIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(terminals.map((t) => [t.id, t.name]));
      const rows = grouped.map((g) => ({
        posTerminalId: g.posTerminalId,
        posTerminalName: g.posTerminalId
          ? (nameById.get(g.posTerminalId) ?? 'Desconocido')
          : 'Sin punto de venta',
        total: money(g._sum.total ?? 0),
        salesCount: g._count,
      }));
      return {
        rows,
        summary: {
          posTerminals: rows.length,
          total: sumMoney(rows.map((r) => r.total)),
        },
      };
    });
  }

  // =========================================================================
  // 15) Ventas por usuario/cajero
  // =========================================================================
  async salesByUserReport(organizationId: string, filters: ReportQueryDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        undefined,
      );
      const grouped = await tx.sale.groupBy({
        by: ['createdById'],
        where,
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: 'desc' } },
      });
      const userIds = grouped
        .map((g) => g.createdById)
        .filter((id): id is string => Boolean(id));
      const names = await this.userNamesMap(tx, organizationId, userIds);
      const rows = grouped.map((g) => ({
        userId: g.createdById,
        userName: g.createdById
          ? (names.get(g.createdById) ?? 'Usuario eliminado')
          : 'Sin usuario',
        total: money(g._sum.total ?? 0),
        salesCount: g._count,
      }));
      return {
        rows,
        summary: {
          users: rows.length,
          total: sumMoney(rows.map((r) => r.total)),
        },
      };
    });
  }

  // =========================================================================
  // 16) Métodos de pago (sobre Payment de Ventas — cobros a clientes)
  // =========================================================================
  async paymentMethodsReport(organizationId: string, filters: ReportQueryDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where: Prisma.PaymentWhereInput = {
        organizationId,
        saleId: { not: null },
        ...(filters.paymentMethod ? { method: filters.paymentMethod } : {}),
        ...(dateRange(filters) ? { createdAt: dateRange(filters) } : {}),
        ...(filters.posTerminalId || filters.branchId
          ? { sale: await this.saleScopeWhere(tx, organizationId, filters) }
          : {}),
      };
      const grouped = await tx.payment.groupBy({
        by: ['method'],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
      });
      const rows = grouped.map((g) => ({
        method: g.method,
        total: money(g._sum.amount ?? 0),
        paymentsCount: g._count,
      }));
      return {
        rows,
        summary: {
          methods: rows.length,
          total: sumMoney(rows.map((r) => r.total)),
        },
      };
    });
  }

  private async saleScopeWhere(
    tx: Tx,
    organizationId: string,
    filters: ReportQueryDto,
  ): Promise<Prisma.SaleWhereInput> {
    const scope = await this.resolveBranchScope(
      tx,
      organizationId,
      filters.branchId,
    );
    return {
      organizationId,
      ...(filters.posTerminalId
        ? { posTerminalId: filters.posTerminalId }
        : {}),
      ...(filters.branchId
        ? {
            OR: [
              { warehouseId: { in: scope.warehouseIds ?? [] } },
              { posTerminalId: { in: scope.posTerminalIds ?? [] } },
            ],
          }
        : {}),
    };
  }

  // =========================================================================
  // 17) Ventas por rango de fechas — serie diaria dentro de dateFrom/dateTo.
  // =========================================================================
  async salesByDateReport(organizationId: string, filters: ReportQueryDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = await this.buildSalesWhere(
        tx,
        organizationId,
        filters,
        undefined,
      );
      const sales = await tx.sale.findMany({
        where,
        select: { id: true, total: true, createdAt: true },
      });
      const byDay = new Map<string, { total: Prisma.Decimal; count: number }>();
      for (const s of sales) {
        const day = s.createdAt.toISOString().slice(0, 10);
        const prev = byDay.get(day) ?? { total: ZERO_MONEY, count: 0 };
        byDay.set(day, {
          total: prev.total.add(s.total),
          count: prev.count + 1,
        });
      }
      const rows = [...byDay.entries()]
        .map(([date, v]) => ({
          date,
          total: money(v.total),
          salesCount: v.count,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      return {
        rows,
        summary: {
          days: rows.length,
          total: sumMoney(rows.map((r) => r.total)),
          salesCount: sales.length,
        },
      };
    });
  }
}
