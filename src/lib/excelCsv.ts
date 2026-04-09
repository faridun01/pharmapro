const EXCEL_CSV_MIME = 'text/csv;charset=utf-8;';
const EXCEL_SEPARATOR = ';';
const UTF8_BOM = '\uFEFF';

const escapeCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const buildExcelFriendlyCsv = (rows: unknown[][], separator = EXCEL_SEPARATOR) => {
  const body = rows.map((row) => row.map((value) => escapeCsvCell(value)).join(separator)).join('\n');
  return `sep=${separator}\n${body}`;
};

export const downloadExcelFriendlyCsv = (fileName: string, rows: unknown[][], separator = EXCEL_SEPARATOR) => {
  const csv = buildExcelFriendlyCsv(rows, separator);
  const blob = new Blob([UTF8_BOM, csv], { type: EXCEL_CSV_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
};
