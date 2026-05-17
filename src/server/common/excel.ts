import * as XLSX from 'xlsx';

type SheetRow = Record<string, string | number | boolean | null | undefined>;

export interface ExcelSheet {
  name: string;
  rows: SheetRow[];
  columns?: { key: string; header: string; width?: number }[];
}

/**
 * Build an xlsx Buffer from one or more sheets.
 */
export function buildXlsxBuffer(sheets: ExcelSheet[]): Buffer {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // If column definitions supplied, use them to order and label columns
    let data: SheetRow[];
    let headerRow: string[];

    if (sheet.columns && sheet.columns.length > 0) {
      headerRow = sheet.columns.map((c) => c.header);
      data = sheet.rows.map((row) =>
        Object.fromEntries(
          sheet.columns!.map((c) => [c.header, row[c.key] ?? null]),
        ),
      );
    } else {
      // Auto-detect headers from first row
      headerRow = Object.keys(sheet.rows[0] ?? {});
      data = sheet.rows;
    }

    const ws = XLSX.utils.json_to_sheet(data, { header: headerRow });

    // Set column widths
    if (sheet.columns) {
      ws['!cols'] = sheet.columns.map((c) => ({ wch: c.width ?? 20 }));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31)); // Excel max sheet name = 31 chars
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}

export function setXlsxHeaders(res: any, filename: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.xlsx"`);
}

export const fmt = {
  date: (d: Date | string | null | undefined): string => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  datetime: (d: Date | string | null | undefined): string => {
    if (!d) return '—';
    return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  money: (n: number | null | undefined): number => Number((Number(n) || 0).toFixed(2)),
  qty: (n: number | null | undefined): number => Number(n) || 0,
};
