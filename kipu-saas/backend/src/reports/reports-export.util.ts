import ExcelJS from 'exceljs';
import { Prisma } from '../../generated/prisma/client';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function formatCell(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return value as string | number;
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\r\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Genera el CSV con las MISMAS `columns`/`rows` que se usan para la vista
 * en pantalla (ver `ReportsController`) — nunca una consulta ni una
 * agregación separada, así que las cifras nunca pueden divergir entre
 * pantalla y exportación (sección "EXPORTACIÓN" del pedido).
 */
export function rowsToCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvField(c.header)).join(','));
  for (const row of rows) {
    lines.push(
      columns.map((c) => escapeCsvField(formatCell(c.value(row)))).join(','),
    );
  }
  // BOM UTF-8: Excel/LibreOffice detectan la codificación correctamente
  // (tildes/ñ) solo si el archivo empieza con este marcador.
  return '﻿' + lines.join('\r\n');
}

export async function rowsToXlsx<T>(
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.header,
    width: 22,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(columns.map((c) => formatCell(c.value(row))));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
