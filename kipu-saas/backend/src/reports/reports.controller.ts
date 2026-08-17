import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ReportsService, REPORT_EXPORT_MAX_ROWS } from './reports.service';
import { ReportExportQueryDto, ReportQueryDto } from './dto/report-query.dto';
import { ExportColumn, rowsToCsv, rowsToXlsx } from './reports-export.util';

// Clave de URL -> { fetch para la VISTA paginada, fetch para EXPORT (mismo
// método, sin paginar hasta el techo), columnas del archivo }. Un solo
// registro evita 17 handlers casi idénticos y garantiza, por construcción,
// que export use EXACTAMENTE la misma consulta/filtros que la vista (nunca
// una tabla o cálculo aparte) — sección "EXPORTACIÓN" del pedido.
interface ReportDefinition {
  title: string;
  fetchView: (
    service: ReportsService,
    organizationId: string,
    query: ReportQueryDto,
  ) => Promise<{ rows: unknown[] }>;
  fetchExport: (
    service: ReportsService,
    organizationId: string,
    query: ReportQueryDto,
  ) => Promise<{ rows: unknown[] }>;

  columns: ExportColumn<any>[];
}

const EXPORT_OPTS = { maxPageSize: REPORT_EXPORT_MAX_ROWS };

// Registro deliberadamente `any`: cada reporte devuelve una forma de fila
// distinta (17 formas reales, ver `ReportsService`) y estas son solo
// funciones de presentación (qué columna mostrar) sobre datos que
// `ReportsService` ya devolvió correctamente tipados — no hay lógica de
// negocio acá que perder por no tipar cada forma con su propia interfaz.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
const REPORTS: Record<string, ReportDefinition> = {
  sales: {
    title: 'Reporte de ventas',
    fetchView: (s, org, q) => s.salesReport(org, q),
    fetchExport: (s, org, q) => s.salesReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'Fecha', value: (r) => r.createdAt },
      { header: 'Estado', value: (r) => r.status },
      { header: 'Cliente', value: (r) => r.customer?.name ?? '' },
      { header: 'Sucursal/Almacén', value: (r) => r.warehouse?.name ?? '' },
      { header: 'POS', value: (r) => r.posTerminal?.name ?? '' },
      { header: 'Subtotal', value: (r) => r.subtotal },
      { header: 'Descuento', value: (r) => r.discount },
      { header: 'Total', value: (r) => r.total },
      { header: 'Items', value: (r) => r._count?.items ?? 0 },
    ],
  },
  purchases: {
    title: 'Reporte de compras',
    fetchView: (s, org, q) => s.purchasesReport(org, q),
    fetchExport: (s, org, q) => s.purchasesReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'Fecha', value: (r) => r.createdAt },
      { header: 'Estado', value: (r) => r.status },
      { header: 'Proveedor', value: (r) => r.supplier?.name ?? '' },
      { header: 'Almacén', value: (r) => r.warehouse?.name ?? '' },
      { header: 'Subtotal', value: (r) => r.subtotal },
      { header: 'Descuento', value: (r) => r.discount },
      { header: 'Total', value: (r) => r.total },
      { header: 'Items', value: (r) => r._count?.items ?? 0 },
    ],
  },
  income: {
    title: 'Reporte de ingresos',
    fetchView: (s, org, q) => s.incomeReport(org, q),
    fetchExport: (s, org, q) => s.incomeReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'Fecha', value: (r) => r.createdAt },
      { header: 'Tipo', value: (r) => r.type },
      { header: 'Caja', value: (r) => r.cashRegister?.id ?? '' },
      { header: 'POS', value: (r) => r.cashRegister?.posTerminal?.name ?? '' },
      { header: 'Monto', value: (r) => r.amount },
      { header: 'Motivo', value: (r) => r.reason ?? '' },
      { header: 'Referencia', value: (r) => r.reference ?? '' },
    ],
  },
  expenses: {
    title: 'Reporte de egresos',
    fetchView: (s, org, q) => s.expensesReport(org, q),
    fetchExport: (s, org, q) => s.expensesReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'Fecha', value: (r) => r.createdAt },
      { header: 'Tipo', value: (r) => r.type },
      { header: 'Caja', value: (r) => r.cashRegister?.id ?? '' },
      { header: 'POS', value: (r) => r.cashRegister?.posTerminal?.name ?? '' },
      { header: 'Monto', value: (r) => r.amount },
      { header: 'Motivo', value: (r) => r.reason ?? '' },
      { header: 'Referencia', value: (r) => r.reference ?? '' },
    ],
  },
  cash: {
    title: 'Reporte de caja',
    fetchView: (s, org, q) => s.cashReport(org, q),
    fetchExport: (s, org, q) => s.cashReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'POS', value: (r) => r.posTerminal?.name ?? '' },
      { header: 'Estado', value: (r) => r.status },
      { header: 'Apertura', value: (r) => r.openedAt },
      { header: 'Cierre', value: (r) => r.closedAt },
      { header: 'Monto apertura', value: (r) => r.openingAmount },
      { header: 'Saldo actual', value: (r) => r.currentBalance },
      { header: 'Contado al cierre', value: (r) => r.closingAmount },
      { header: 'Esperado al cierre', value: (r) => r.expectedAmount },
      { header: 'Diferencia', value: (r) => r.difference },
    ],
  },
  inventory: {
    title: 'Reporte de inventario',
    fetchView: (s, org, q) => s.inventoryReport(org, q),
    fetchExport: (s, org, q) => s.inventoryReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'Producto', value: (r) => r.product?.name ?? '' },
      { header: 'SKU', value: (r) => r.product?.sku ?? '' },
      { header: 'Almacén', value: (r) => r.warehouse?.name ?? '' },
      { header: 'Cantidad', value: (r) => r.quantity },
      { header: 'Costo unitario', value: (r) => r.unitCost },
      { header: 'Valor', value: (r) => r.value },
      { header: 'Stock bajo', value: (r) => r.lowStock },
    ],
  },
  movements: {
    title: 'Kardex / movimientos de inventario',
    fetchView: (s, org, q) => s.movementsReport(org, q),
    fetchExport: (s, org, q) =>
      s.movementsReport(
        org,
        { ...q, pageSize: REPORT_EXPORT_MAX_ROWS },
        EXPORT_OPTS,
      ),
    columns: [
      { header: 'Fecha', value: (r) => r.createdAt },
      { header: 'Producto', value: (r) => r.product?.name ?? '' },
      { header: 'Almacén', value: (r) => r.warehouse?.name ?? '' },
      { header: 'Tipo', value: (r) => r.type },
      { header: 'Cantidad', value: (r) => r.quantity },
      { header: 'Saldo antes', value: (r) => r.stockBefore },
      { header: 'Saldo después', value: (r) => r.stockAfter },
      { header: 'Motivo', value: (r) => r.reason ?? '' },
      { header: 'Referencia', value: (r) => r.reference ?? '' },
    ],
  },
  receivables: {
    title: 'Cuentas por cobrar',
    fetchView: (s, org, q) => s.receivablesReport(org, q),
    fetchExport: (s, org, q) => s.receivablesReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'Cliente', value: (r) => r.customer?.name ?? '' },
      { header: 'Vencimiento', value: (r) => r.dueDate },
      { header: 'Estado', value: (r) => r.status },
      { header: 'Monto', value: (r) => r.amount },
      { header: 'Pagado', value: (r) => r.paidTotal },
      { header: 'Saldo', value: (r) => r.balance },
    ],
  },
  payables: {
    title: 'Cuentas por pagar',
    fetchView: (s, org, q) => s.payablesReport(org, q),
    fetchExport: (s, org, q) => s.payablesReport(org, q, EXPORT_OPTS),
    columns: [
      { header: 'ID', value: (r) => r.id },
      { header: 'Proveedor', value: (r) => r.supplier?.name ?? '' },
      { header: 'Vencimiento', value: (r) => r.dueDate },
      { header: 'Estado', value: (r) => r.status },
      { header: 'Monto', value: (r) => r.amount },
      { header: 'Pagado', value: (r) => r.paidTotal },
      { header: 'Saldo', value: (r) => r.balance },
    ],
  },
  'top-products': {
    title: 'Productos más vendidos',
    fetchView: (s, org, q) => s.topProductsReport(org, q),
    fetchExport: (s, org, q) => s.topProductsReport(org, q),
    columns: [
      { header: 'Producto', value: (r) => r.product?.name ?? '' },
      { header: 'SKU', value: (r) => r.product?.sku ?? '' },
      { header: 'Cantidad vendida', value: (r) => r.quantity },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
  'sales-by-product': {
    title: 'Ventas por producto',
    fetchView: (s, org, q) => s.salesByProductReport(org, q),
    fetchExport: (s, org, q) => s.salesByProductReport(org, q),
    columns: [
      { header: 'Producto', value: (r) => r.product?.name ?? '' },
      { header: 'SKU', value: (r) => r.product?.sku ?? '' },
      { header: 'Cantidad vendida', value: (r) => r.quantity },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
  'sales-by-category': {
    title: 'Ventas por categoría',
    fetchView: (s, org, q) => s.salesByCategoryReport(org, q),
    fetchExport: (s, org, q) => s.salesByCategoryReport(org, q),
    columns: [
      { header: 'Categoría', value: (r) => r.categoryName },
      { header: 'Cantidad vendida', value: (r) => r.quantity },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
  'sales-by-branch': {
    title: 'Ventas por sucursal',
    fetchView: (s, org, q) => s.salesByBranchReport(org, q),
    fetchExport: (s, org, q) => s.salesByBranchReport(org, q),
    columns: [
      { header: 'Sucursal', value: (r) => r.branchName },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
  'sales-by-pos': {
    title: 'Ventas por punto de venta',
    fetchView: (s, org, q) => s.salesByPosReport(org, q),
    fetchExport: (s, org, q) => s.salesByPosReport(org, q),
    columns: [
      { header: 'Punto de venta', value: (r) => r.posTerminalName },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
  'sales-by-user': {
    title: 'Ventas por usuario/cajero',
    fetchView: (s, org, q) => s.salesByUserReport(org, q),
    fetchExport: (s, org, q) => s.salesByUserReport(org, q),
    columns: [
      { header: 'Usuario', value: (r) => r.userName },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
  'payment-methods': {
    title: 'Métodos de pago',
    fetchView: (s, org, q) => s.paymentMethodsReport(org, q),
    fetchExport: (s, org, q) => s.paymentMethodsReport(org, q),
    columns: [
      { header: 'Método', value: (r) => r.method },
      { header: 'Total cobrado', value: (r) => r.total },
      { header: 'N.º de pagos', value: (r) => r.paymentsCount },
    ],
  },
  'sales-by-date': {
    title: 'Ventas por rango de fechas',
    fetchView: (s, org, q) => s.salesByDateReport(org, q),
    fetchExport: (s, org, q) => s.salesByDateReport(org, q),
    columns: [
      { header: 'Fecha', value: (r) => r.date },
      { header: 'Total vendido', value: (r) => r.total },
      { header: 'N.º de ventas', value: (r) => r.salesCount },
    ],
  },
};
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('sales')
  @RequirePermissions('reports.read')
  sales(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesReport(auth.organizationId, query);
  }

  @Get('purchases')
  @RequirePermissions('reports.read')
  purchases(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.purchasesReport(auth.organizationId, query);
  }

  @Get('income')
  @RequirePermissions('reports.read')
  income(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.incomeReport(auth.organizationId, query);
  }

  @Get('expenses')
  @RequirePermissions('reports.read')
  expenses(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.expensesReport(auth.organizationId, query);
  }

  @Get('cash')
  @RequirePermissions('reports.read')
  cash(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.cashReport(auth.organizationId, query);
  }

  @Get('inventory')
  @RequirePermissions('reports.read')
  inventory(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.inventoryReport(auth.organizationId, query);
  }

  @Get('movements')
  @RequirePermissions('reports.read')
  movements(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.movementsReport(auth.organizationId, query);
  }

  @Get('receivables')
  @RequirePermissions('reports.read')
  receivables(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.receivablesReport(auth.organizationId, query);
  }

  @Get('payables')
  @RequirePermissions('reports.read')
  payables(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.payablesReport(auth.organizationId, query);
  }

  @Get('top-products')
  @RequirePermissions('reports.read')
  topProducts(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.topProductsReport(auth.organizationId, query);
  }

  @Get('sales-by-product')
  @RequirePermissions('reports.read')
  salesByProduct(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesByProductReport(auth.organizationId, query);
  }

  @Get('sales-by-category')
  @RequirePermissions('reports.read')
  salesByCategory(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesByCategoryReport(auth.organizationId, query);
  }

  @Get('sales-by-branch')
  @RequirePermissions('reports.read')
  salesByBranch(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesByBranchReport(auth.organizationId, query);
  }

  @Get('sales-by-pos')
  @RequirePermissions('reports.read')
  salesByPos(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesByPosReport(auth.organizationId, query);
  }

  @Get('sales-by-user')
  @RequirePermissions('reports.read')
  salesByUser(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesByUserReport(auth.organizationId, query);
  }

  @Get('payment-methods')
  @RequirePermissions('reports.read')
  paymentMethods(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.paymentMethodsReport(auth.organizationId, query);
  }

  @Get('sales-by-date')
  @RequirePermissions('reports.read')
  salesByDate(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.salesByDateReport(auth.organizationId, query);
  }

  /**
   * Export genérico por clave de reporte. `fetchExport` reutiliza EXACTO el
   * mismo método/filtros que la vista correspondiente (arriba) — nunca una
   * consulta separada — así que el archivo nunca puede mostrar cifras
   * distintas a las que el usuario ya vio en pantalla con los mismos
   * filtros.
   */
  @Get(':key/export')
  @RequirePermissions('reports.read')
  async export(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('key') key: string,
    @Query() query: ReportExportQueryDto,
    @Res() res: Response,
  ) {
    const definition = REPORTS[key];
    if (!definition) {
      throw new BadRequestException(`Reporte desconocido: "${key}"`);
    }

    const { rows } = await definition.fetchExport(
      this.reports,
      auth.organizationId,
      query,
    );
    const filename = `${key}-${new Date().toISOString().slice(0, 10)}`;

    await this.audit.log({
      organizationId: auth.organizationId,
      userId: auth.sub,
      action: 'reports.export',
      entityType: 'Report',
      entityId: key,
      metadata: { format: query.format, rows: rows.length, filters: query },
    });

    if (query.format === 'xlsx') {
      const buffer = await rowsToXlsx(
        definition.title,
        definition.columns,
        rows,
      );
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    const csv = rowsToCsv(definition.columns, rows);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    });
    res.send(csv);
  }
}
