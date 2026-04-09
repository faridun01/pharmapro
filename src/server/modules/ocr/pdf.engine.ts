/**
 * PDF text extraction engine.
 * Works on digital PDFs (text-based) — no OCR needed.
 * For scanned PDFs without embedded text, returns an empty items list.
 */

import type { OcrResult } from './ocr.types';

type PdfParseResult = { text: string };
type PdfParseInstance = {
  getText: () => Promise<PdfParseResult>;
  destroy?: () => Promise<void> | void;
};
type PdfParseCtor = new (options: { data: Buffer }) => PdfParseInstance;

let pdfParseLoader: Promise<PdfParseCtor> | null = null;

const loadPdfParse = async (): Promise<PdfParseCtor> => {
  if (!pdfParseLoader) {
    pdfParseLoader = import('pdf-parse').then((module) => {
      const candidate = (module as { PDFParse?: unknown }).PDFParse;
      if (typeof candidate !== 'function') {
        throw new Error('pdf-parse module did not expose PDFParse class');
      }
      return candidate as PdfParseCtor;
    });
  }

  return pdfParseLoader;
};

// ─── Date helpers (duplicated from tesseract.engine to keep modules independent) ──

function normalizeDateStr(s: string): string | undefined {
  const m1 = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m1) {
    const year = m1[3].length === 2 ? '20' + m1[3] : m1[3];
    return `${year}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  }
  const m2 = s.match(/^(\d{1,2})[.\/-](\d{4})$/);
  if (m2) return `${m2[2]}-${m2[1].padStart(2, '0')}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return undefined;
}

function parseNum(s: string): number {
  const clean = s.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(clean.replace(',', '.')) || 0;
}

// Header extraction (invoice number, supplier, date) from first 30 lines
function extractHeader(lines: string[]) {
  let invoiceNumber = '';
  let supplierName = '';
  let invoiceDate = '';
  for (const line of lines.slice(0, 30)) {
    if (!invoiceNumber) {
      const m = line.match(/(?:накладная|счёт|фактура|invoice|акт|заказ)\s*[№#]?\s*([A-ZА-ЯЁa-zа-яёA-Z0-9\/\-]{2,25})/i);
      if (m?.[1]) invoiceNumber = m[1].trim();
    }
    if (!invoiceDate) {
      const m = line.match(/(?:от|дата|date)?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i);
      if (m?.[1]) {
        const norm = normalizeDateStr(m[1]);
        if (norm) invoiceDate = norm;
      }
    }
    if (!supplierName) {
      const kw = line.match(/(?:поставщик|supplier|продавец|от кого)\s*[:\-]?\s*(.+)/i);
      if (kw?.[1]) supplierName = kw[1].trim();
      else if (/\b(ооо|зао|ип\s|оао|пао|ltd|llc|gmbh|inc\.?)\b/i.test(line)) {
        supplierName = line.replace(/^\d+\.?\s*/, '').trim();
      }
    }
    if (invoiceNumber && invoiceDate && supplierName) break;
  }
  return { invoiceNumber, supplierName, invoiceDate };
}

const UNIT_RE = /^(уп|уп\.|шт|шт\.|кг|г|мл|мл\.|л|таб|капс|флак|пак|амп|box|unit|units|pc|pcs|kg|g|ml|tab|caps|фл|бл|бут)$/i;

function parseInvoiceLine(line: string): OcrResult['items'][0] | null {
  const raw = line.trim();
  if (raw.length < 6) return null;
  if (/^[-=_|+]{3,}$/.test(raw)) return null;
  if (/(?:наименование|наимен\.?|название|product\s+name|товар|кол-во|количество|цена\s|сумма|серия.*срок|batch|expiry|ед\.?изм|unit\s|итого|всего|total|subtotal)/i.test(raw)) return null;

  const expiryRx = /\b(\d{1,2}[.\/-]\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})\b/g;
  const expiryMatches: Array<{ raw: string; norm: string }> = [];
  let m: RegExpExecArray | null;
  expiryRx.lastIndex = 0;
  while ((m = expiryRx.exec(raw)) !== null) {
    const norm = normalizeDateStr(m[1]);
    if (norm) {
      const year = parseInt(norm.slice(0, 4));
      if (year >= 2018 && year <= 2040) expiryMatches.push({ raw: m[0], norm });
    }
  }
  const expiryDate = expiryMatches[0]?.norm;
  const dateNums = new Set<number>();
  expiryMatches.forEach((e) => e.raw.split(/[.\/-]/).forEach((p) => { const n = parseInt(p); if (n > 0) dateNums.add(n); }));

  let cleanLine = raw;
  for (const e of expiryMatches) cleanLine = cleanLine.replace(e.raw, ' ');

  const batchRx = /\b([A-ZА-ЯЁ]{1,4}[-]?[A-ZА-ЯЁ0-9]{2,10}(?:[-][A-ZА-ЯЁ0-9]{1,8})?)\b/g;
  const batchCandidates = [...cleanLine.matchAll(batchRx)].map((mm) => mm[1]);
  const batchNumber = batchCandidates.find((b) => b.length >= 3 && /\d/.test(b) && /[A-ZА-ЯЁ]/i.test(b));
  if (batchNumber) cleanLine = cleanLine.replace(new RegExp(`\\b${batchNumber}\\b`, 'i'), ' ');

  cleanLine = cleanLine.replace(/\s+/g, ' ').trim();
  const tokens = cleanLine.split(/\s+/);

  type TokType = 'rownum' | 'number' | 'unit' | 'text';
  const classified: Array<{ raw: string; type: TokType; val?: number }> = tokens.map((t, i) => {
    if (i === 0 && /^\d{1,3}\.?$/.test(t)) return { raw: t, type: 'rownum' };
    if (/^[\d.,]+$/.test(t)) { const v = parseNum(t); return { raw: t, type: 'number', val: v > 0 ? v : undefined }; }
    if (UNIT_RE.test(t)) return { raw: t, type: 'unit' };
    return { raw: t, type: 'text' };
  });

  const nameTokens: string[] = [];
  let firstNumIdx = -1;
  for (let i = 0; i < classified.length; i++) {
    const c = classified[i];
    if (c.type === 'rownum' || c.type === 'unit') continue;
    if (c.type === 'number') { firstNumIdx = i; break; }
    nameTokens.push(c.raw);
  }
  while (nameTokens.length > 0 && nameTokens[nameTokens.length - 1].length === 1) nameTokens.pop();
  const name = nameTokens.join(' ').trim().replace(/\s+/g, ' ');
  if (name.length < 3) return null;

  const numSlice = firstNumIdx >= 0 ? classified.slice(firstNumIdx) : classified;
  const numVals = numSlice
    .filter((c) => c.type === 'number' && c.val !== undefined && !dateNums.has(c.val!))
    .map((c) => c.val!);
  if (numVals.length < 1) return null;

  let quantity = 1;
  let costPrice = 0;

  if (numVals.length === 1) {
    costPrice = numVals[0];
  } else if (numVals.length === 2) {
    const [a, b] = numVals;
    if (Number.isInteger(a) && a >= 1 && a <= 9999) { quantity = a; costPrice = b; }
    else { costPrice = Math.min(a, b); const ratio = Math.max(a, b) / Math.min(a, b); if (Number.isInteger(Math.round(ratio)) && ratio >= 1 && ratio <= 9999) quantity = Math.round(ratio); }
  } else {
    let found = false;
    outer:
    for (let i = 0; i < numVals.length - 1; i++) {
      for (let j = i + 1; j < numVals.length; j++) {
        if (j === i + 2 || !found) {
          const a = numVals[i], b = numVals[i + 1], c = numVals[i + 2];
          if (c !== undefined && c > 0 && Math.abs(a * b - c) / c < 0.06 && a >= 1 && a <= 9999) {
            quantity = Math.round(a); costPrice = b; found = true; break outer;
          }
        }
      }
    }
    if (!found) {
      const intVals = numVals.filter((v) => Number.isInteger(v) && v >= 1 && v <= 9999);
      const decVals = numVals.filter((v) => !Number.isInteger(v) && v > 0);
      if (intVals.length >= 1 && decVals.length >= 1) { quantity = intVals[0]; costPrice = Math.min(...decVals); }
      else if (numVals.length >= 2) { const ll = numVals[numVals.length - 1]; const sl = numVals[numVals.length - 2]; costPrice = Number.isInteger(sl) && sl <= 9999 ? ll : Math.min(sl, ll); if (Number.isInteger(sl) && sl <= 9999) quantity = sl; }
    }
  }

  if (costPrice <= 0) return null;
  return { name, quantity: Math.max(1, Math.round(quantity)), costPrice: Math.max(0, costPrice), batchNumber: batchNumber || undefined, expiryDate: expiryDate || undefined };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runPdfOcr(pdfBase64: string): Promise<OcrResult> {
  const PDFParse = await loadPdfParse();
  const buffer = Buffer.from(pdfBase64, 'base64');
  const parser = new PDFParse({ data: buffer });
  const data = await parser.getText();
  await parser.destroy?.();

  const rawText = (data.text || '').trim();
  if (!rawText) {
    return {
      invoiceNumber: '',
      supplierName: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      rawText: '',
      items: [],
    };
  }

  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const header = extractHeader(lines);
  const seen = new Set<string>();
  const items: OcrResult['items'] = [];
  for (const line of lines) {
    const item = parseInvoiceLine(line);
    if (!item) continue;
    const key = item.name.slice(0, 20).toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  return {
    invoiceNumber: header.invoiceNumber,
    supplierName: header.supplierName,
    invoiceDate: header.invoiceDate || new Date().toISOString().split('T')[0],
    rawText,
    items,
  };
}
