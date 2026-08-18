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

/**
 * Qué cuenta como una venta/compra REAL cuando el usuario no filtra por
 * estado. No es un criterio nuevo: es exactamente el que el Dashboard ya
 * aplicaba desde la Fase Comercial 7 (`getDashboardSummary`), extraído acá
 * para que exista UNA sola definición y Reportes no pueda divergir del
 * Dashboard — mismo enfoque que `CASH_INCREASE_TYPES`/`CASH_DECREASE_TYPES`,
 * que Reportes importa de `cash.service.ts` en vez de reimplementar.
 *
 * Entran: `CONFIRMED`, `PARTIALLY_PAID`, `PAID` (ventas) y `CONFIRMED`,
 * `PARTIALLY_RECEIVED`, `RECEIVED` (compras) — operaciones efectivamente
 * cerradas con el cliente/proveedor.
 *
 * Quedan fuera:
 *  - `DRAFT`: un carrito/orden que nunca se confirmó. No descontó stock ni
 *    generó obligación; no es una operación, es una intención.
 *  - `CANCELLED`: anulada, sus efectos ya fueron revertidos.
 *  - `REFUNDED` (solo ventas): el dinero ya se devolvió, no es ingreso neto
 *    del período. El Dashboard documenta esta exclusión explícitamente.
 *
 * Si el usuario pide un estado explícito (`?status=CANCELLED`), ese filtro
 * gana y se muestra exactamente lo pedido — incluidos DRAFT/CANCELLED/
 * REFUNDED, que siguen siendo auditables a propósito.
 */
export const REAL_SALE_STATUSES = [
  'CONFIRMED',
  'PARTIALLY_PAID',
  'PAID',
] as const;
export const REAL_PURCHASE_STATUSES = [
  'CONFIRMED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
] as const;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
/** Techo de filas devueltas por un export — evita cargar un dataset ilimitado en memoria (sección RENDIMIENTO del pedido). */
export const REPORT_EXPORT_MAX_ROWS = 20_000;
const DEFAULT_TOP_LIMIT = 10;
const MAX_LIMIT = 500;
/**
 * Tamaño de lote al recorrer ventas para los reportes agregados que no
 * pueden resolverse con un `groupBy` de Prisma (ver `forEachSaleBatch`).
 * Acota la memoria: el proceso nunca tiene más de estas filas a la vez,
 * sin importar cuántas ventas matcheen el filtro.
 */
const SALE_SCAN_BATCH_SIZE = 1_000;

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

  /**
   * Recorre las ventas que matchean `where` en lotes acotados, sin cargarlas
   * todas en memoria. Se usa en los reportes agregados cuyo criterio de
   * agrupación NO existe como columna de `sales` (día calendario, categoría
   * del producto), donde `groupBy` de Prisma no alcanza.
   *
   * Por qué lotes y no una consulta cruda con GROUP BY: el `where` lo arma
   * `buildSalesWhere`, que es la ÚNICA definición de qué ventas entran en un
   * reporte (filtros + criterio de estado por defecto). Reescribir ese filtro
   * a mano en SQL para poder agrupar del lado del servidor duplicaría esa
   * lógica y abriría la puerta a que ambos caminos diverjan — justo lo que el
   * resto del módulo evita. Recorriendo por lotes, las cifras salen del mismo
   * `where` por construcción y la memoria queda acotada a
   * `SALE_SCAN_BATCH_SIZE` filas + el mapa de grupos (días/categorías, que son
   * pocos por naturaleza).
   *
   * Pagina por cursor sobre `id` (no `skip`/`take`): con desplazamiento, una
   * venta insertada durante el recorrido correría las páginas y podría
   * duplicar o saltear filas.
   */
  private async forEachSaleBatch<Row extends { id: string }>(
    tx: Tx,
    where: Prisma.SaleWhereInput,
    select: Prisma.SaleSelect,
    onBatch: (batch: Row[]) => void | Promise<void>,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const batch = (await tx.sale.findMany({
        where,
        // `id` siempre se selecciona: es la clave del cursor.
        select: { ...select, id: true },
        orderBy: { id: 'asc' },
        take: SALE_SCAN_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })) as unknown as Row[];
      if (batch.length === 0) return;
      await onBatch(batch);
      // Un lote incompleto significa que no quedan más filas.
      if (batch.length < SALE_SCAN_BATCH_SIZE) return;
      cursor = batch[batch.length - 1].id;
    }
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
      // Estado explícito del usuario > criterio por defecto (ver
      // REAL_SALE_STATUSES). Sin filtro, "ventas" significa ventas reales,
      // no borradores ni anuladas ni devueltas.
      ...(status ? { status } : { status: { in: [...REAL_SALE_STATUSES] } }),
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
        // Mismo criterio que en ventas (ver REAL_PURCHASE_STATUSES): sin
        // filtro explícito, una compra en DRAFT o CANCELLED no cuenta.
        ...(status
          ? { status }
          : { status: { in: [...REAL_PURCHASE_STATUSES] } }),
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
  // `opts.maxPageSize` limita cuántas filas se muestran en pantalla/export
  // (200 por defecto, más alto para export vía EXPORT_OPTS). El `summary`
  // (totalValue/totalQuantity/lowStockCount), en cambio, SIEMPRE se calcula
  // sobre el inventario COMPLETO de la organización que matchea los
  // filtros — nunca solo sobre las filas mostradas — por eso acá se pide
  // `listStock` SIN límite (`{ maxRows: undefined }`) y el corte a
  // `maxPageSize` se aplica después, en memoria, solo sobre qué filas se
  // devuelven para mostrar. Antes de esta corrección, `summary.totalValue`
  // se calculaba únicamente sobre las 200 filas devueltas por
  // `listStock`, subreportando la valorización total en cualquier
  // organización con más de 200 combinaciones producto×almacén, sin
  // ningún indicio visible de truncamiento.
  async inventoryReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const rows = await this.inventory.listStock(
      organizationId,
      {
        warehouseId: filters.warehouseId,
        productId: filters.productId,
      },
      { maxRows: undefined },
    );
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

      const maxPageSize = opts?.maxPageSize ?? 200;
      return {
        rows: valuedRows.slice(0, maxPageSize),
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
  async movementsReport(
    organizationId: string,
    filters: ReportQueryDto,
    opts?: { maxPageSize?: number },
  ) {
    const rows = await this.inventory.listMovements(
      organizationId,
      {
        warehouseId: filters.warehouseId,
        productId: filters.productId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        page: filters.page,
        pageSize: filters.pageSize,
      },
      { maxPageSize: opts?.maxPageSize },
    );
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
      // Antes se materializaba el id de TODAS las ventas que matchean el
      // filtro para meterlas en un único `IN (...)`: con años de historial ese
      // array (y la sentencia SQL resultante) crecía sin techo. Ahora se
      // recorre por lotes acotados y se agrega cada lote en Postgres,
      // fusionando los parciales acá.
      //
      // Sumar los parciales es exacto, no una aproximación: los lotes
      // particionan las ventas (cada venta cae en uno solo), así que tanto los
      // `SUM` como el `COUNT(DISTINCT si."saleId")` por categoría se suman sin
      // riesgo de contar dos veces la misma venta.
      const byCategory = new Map<
        string,
        {
          categoryId: string | null;
          categoryName: string | null;
          quantity: Prisma.Decimal;
          total: Prisma.Decimal;
          salesCount: number;
        }
      >();

      await this.forEachSaleBatch<{ id: string }>(
        tx,
        where,
        {},
        async (batch) => {
          const ids = batch.map((s) => s.id);
          const partial = await tx.$queryRaw<
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
        `;
          for (const r of partial) {
            const key = r.categoryId ?? 'sin-categoria';
            const prev = byCategory.get(key);
            if (prev) {
              prev.quantity = prev.quantity.add(r.quantity);
              prev.total = prev.total.add(r.total);
              prev.salesCount += Number(r.salesCount);
            } else {
              byCategory.set(key, {
                categoryId: r.categoryId,
                categoryName: r.categoryName,
                quantity: money(r.quantity),
                total: money(r.total),
                salesCount: Number(r.salesCount),
              });
            }
          }
        },
      );

      const normalized = [...byCategory.values()]
        .map((r) => ({
          categoryId: r.categoryId,
          categoryName: r.categoryName ?? 'Sin categoría',
          quantity: money(r.quantity),
          total: money(r.total),
          salesCount: r.salesCount,
        }))
        // El ORDER BY vivía en el SQL; al fusionar lotes hay que ordenar acá
        // para conservar el mismo resultado (mayor facturación primero).
        .sort((a, b) => Number(b.total.sub(a.total)));

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
      // La suma la hace Postgres, no Node: antes se traían TODAS las ventas
      // que matcheaban el filtro para sumarlas en JavaScript, lo que en una
      // organización con años de historial (y sin filtro de fecha, que es
      // opcional) podía significar cargar la tabla entera en memoria.
      //
      // `sales` no tiene columna `branchId` — la sucursal se deriva del punto
      // de venta o, si no hay, del almacén — así que se agrupa por ese par.
      // La cardinalidad del resultado está acotada por la cantidad de
      // terminales × almacenes que existen, no por la cantidad de ventas.
      const grouped = await tx.sale.groupBy({
        by: ['posTerminalId', 'warehouseId'],
        where,
        _sum: { total: true },
        _count: true,
      });

      const posIds = grouped
        .map((g) => g.posTerminalId)
        .filter((id): id is string => Boolean(id));
      const warehouseIds = grouped
        .map((g) => g.warehouseId)
        .filter((id): id is string => Boolean(id));
      // Dos consultas acotadas (no una por fila): sin N+1.
      const [terminals, warehouses] = await Promise.all([
        tx.pOSTerminal.findMany({
          where: { organizationId, id: { in: posIds } },
          select: { id: true, branchId: true },
        }),
        tx.warehouse.findMany({
          where: { organizationId, id: { in: warehouseIds } },
          select: { id: true, branchId: true },
        }),
      ]);
      const branchByPos = new Map(terminals.map((t) => [t.id, t.branchId]));
      const branchByWarehouse = new Map(
        warehouses.map((w) => [w.id, w.branchId]),
      );

      const totalsByBranch = new Map<
        string,
        { total: Prisma.Decimal; count: number }
      >();
      let salesCount = 0;
      for (const g of grouped) {
        // Misma precedencia que antes: manda el punto de venta; el almacén
        // es el respaldo cuando la venta no tiene POS.
        const branchId =
          (g.posTerminalId ? branchByPos.get(g.posTerminalId) : null) ??
          (g.warehouseId ? branchByWarehouse.get(g.warehouseId) : null) ??
          'sin-sucursal';
        const prev = totalsByBranch.get(branchId) ?? {
          total: ZERO_MONEY,
          count: 0,
        };
        totalsByBranch.set(branchId, {
          total: prev.total.add(g._sum.total ?? 0),
          count: prev.count + g._count,
        });
        salesCount += g._count;
      }

      const branches = await tx.branch.findMany({
        where: { organizationId, id: { in: [...totalsByBranch.keys()] } },
        select: { id: true, name: true },
      });
      const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

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
          salesCount,
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
  /**
   * A diferencia del resto de los reportes de ventas, este NO aplica
   * `REAL_SALE_STATUSES`, y es deliberado: agrupa filas de `Payment`, es
   * decir dinero efectivamente cobrado, no ventas. Los dos estados que el
   * criterio por defecto excluye no pueden distorsionar esta cifra:
   *  - `DRAFT`/`CANCELLED`: una venta solo puede cancelarse estando en
   *    borrador (`SalesService.cancel`), y un borrador todavía no tiene
   *    pagos — recién se cobran al confirmar o después. Nunca hay `Payment`
   *    colgando de una venta cancelada.
   *  - `REFUNDED`: ese pago SÍ entró por ese método en su momento; la
   *    reversa se registra aparte como `Refund` + movimiento de caja
   *    `SALE_REFUND`. Filtrarlo acá haría desaparecer un cobro que
   *    realmente ocurrió.
   */
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
      // El día calendario no es una columna de `sales` (se deriva de
      // `createdAt`), así que `groupBy` de Prisma no sirve acá. Se recorre por
      // lotes acotados en vez de traer todas las ventas de una: la memoria
      // queda en el tamaño del lote + un día por entrada del mapa, en lugar de
      // crecer con la cantidad total de ventas. Las cifras son idénticas — es
      // la misma acumulación, sobre el mismo `where`.
      const byDay = new Map<string, { total: Prisma.Decimal; count: number }>();
      let salesCount = 0;
      await this.forEachSaleBatch<{
        id: string;
        total: Prisma.Decimal;
        createdAt: Date;
      }>(tx, where, { total: true, createdAt: true }, (batch) => {
        for (const s of batch) {
          const day = s.createdAt.toISOString().slice(0, 10);
          const prev = byDay.get(day) ?? { total: ZERO_MONEY, count: 0 };
          byDay.set(day, {
            total: prev.total.add(s.total),
            count: prev.count + 1,
          });
          salesCount += 1;
        }
      });
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
          salesCount,
        },
      };
    });
  }
}
