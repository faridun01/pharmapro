import { spawn } from 'node:child_process';
import path from 'node:path';

import type { OcrConfidence, OcrResult, OcrResultItem } from './ocr.types';
import { runOllamaTextNormalization, runOllamaVisionOcr } from './ollama.engine';
import { runPdfOcr } from './pdf.engine';

type PdfParseResult = { text: string };
type PdfParseInstance = {
  getText: () => Promise<PdfParseResult>;
  destroy?: () => Promise<void> | void;
};
type PdfParseCtor = new (options: { data: Buffer }) => PdfParseInstance;

export type PdfType = 'text-table' | 'text' | 'scan';

type CamelotExtractedRow = {
  name?: string;
  unit?: string;
  quantity?: string | number;
  pricePerUnit?: string | number;
  unitsPerBox?: string | number;
  boxPrice?: string | number;
  rawCells?: string[];
  sourceTable?: number;
  issues?: string[];
};

type CleanedStructuredRow = {
  name: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  unitsPerBox: number;
  boxPrice: number;
  expectedBoxPrice: number;
  delta: number;
  status: 'OK' | 'CHECK';
  warnings: string[];
};

type CamelotExtractResult = {
  flavor: 'lattice' | 'stream';
  tableCount: number;
  rows: CamelotExtractedRow[];
  rawTableText?: string;
  issues?: string[];
};

type RenderedPdfPage = {
  imageBase64: string;
  mimeType: string;
  pageCount?: number;
};

export type ProcessPdfDocumentResult = {
  pdfType: PdfType;
  engine: 'pdf+camelot' | 'pdf+ollama' | 'pdf+vision+ollama' | 'pdf+legacy';
  result: OcrResult;
  warnings: string[];
};

const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || 'c:/python313/python.exe';
const CAMELOT_SCRIPT = path.join(process.cwd(), 'scripts', 'pdf_camelot_extract.py');
const PDF_RENDER_SCRIPT = path.join(process.cwd(), 'scripts', 'pdf_render_page.py');
const PDF_PARSE_TIMEOUT_MS = Number(process.env.PDF_PARSE_TIMEOUT_MS || 30000);
const PDF_RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS || 30000);

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

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const normalizeQuotes = (value: string) =>
  value
    .replace(/[«»]/g, '"')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

const normalizeTextValue = (value: unknown) => normalizeWhitespace(normalizeQuotes(String(value ?? '')));

const normalizeNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const source = String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!source) return 0;

  const cleaned = source
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, '')
    .replace(/(,)(?=.*[,])/g, '')
    .replace(/(\.)(?=.*[.])/g, '');

  if (!cleaned) return 0;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }

  return Number(cleaned.replace(',', '.')) || 0;
};

const normalizeDateString = (value?: string) => {
  if (!value) return '';
  const source = String(value).trim();
  if (!source) return '';
  const fullDate = source.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (fullDate) {
    const year = fullDate[3].length === 2 ? `20${fullDate[3]}` : fullDate[3];
    return `${year}-${fullDate[2].padStart(2, '0')}-${fullDate[1].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0];
};

const normalizeUnit = (value: unknown) => {
  const normalized = normalizeTextValue(value).toLowerCase();
  if (!normalized) return '';
  if (normalized.startsWith('короб')) return 'коробка';
  if (normalized.startsWith('меш')) return 'мешок';
  if (normalized === 'шт.' || normalized === 'шт') return 'шт';
  return normalized;
};

const normalizeHeader = (value: string) =>
  normalizeTextValue(value)
    .toLowerCase()
    .replace(/[қќ]/g, 'к')
    .replace(/[ҳ]/g, 'х')
    .replace(/[ғ]/g, 'г')
    .replace(/[ҷ]/g, 'ж')
    .replace(/[ӯ]/g, 'у')
    .replace(/[ӣ]/g, 'и')
    .replace(/[ё]/g, 'е')
    .replace(/[\s_\-./\\()]/g, '');

const detectTableLikeText = (rawText: string) => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;

  const headerHits = lines.slice(0, 20).filter((line) =>
    /(наимен|товар|price|qty|quantity|сумма|итого|unit|колич|цена|упаков|короб|invoice|артикул)/i.test(line),
  ).length;

  const rowHits = lines.filter((line) => {
    const numericParts = line.match(/\d+[.,]?\d*/g) || [];
    const hasSeparators = line.includes('|') || /\s{2,}/.test(line);
    const hasText = /[A-Za-zА-Яа-яЁё]/.test(line);
    return hasText && numericParts.length >= 2 && hasSeparators;
  }).length;

  return (headerHits >= 1 && rowHits >= 2) || rowHits >= 4;
};

const extractHeader = (rawText: string) => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
  let invoiceNumber = '';
  let supplierName = '';
  let invoiceDate = '';

  for (const line of lines.slice(0, 30)) {
    if (!invoiceNumber) {
      const match = line.match(/(?:накладная|сч[её]т|фактура|invoice|акт|заказ)\s*[№#]?\s*([A-ZА-ЯЁa-zа-яё0-9\/-]{2,30})/i);
      if (match?.[1]) invoiceNumber = match[1].trim();
    }

    if (!invoiceDate) {
      const match = line.match(/(?:от|дата|date)?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i);
      if (match?.[1]) invoiceDate = normalizeDateString(match[1]);
    }

    if (!supplierName) {
      const keywordMatch = line.match(/(?:поставщик|supplier|продавец|от кого)\s*[:\-]?\s*(.+)/i);
      if (keywordMatch?.[1]) supplierName = keywordMatch[1].trim();
    }
  }

  return {
    invoiceNumber,
    supplierName,
    invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
  };
};

const buildConfidenceSummary = (items: OcrResultItem[]) => {
  const total = items.length;
  const high = items.filter((item) => item.confidence === 'HIGH').length;
  const medium = items.filter((item) => item.confidence === 'MEDIUM').length;
  const low = items.filter((item) => item.confidence === 'LOW').length;
  const needsReview = items.filter((item) => item.needsReview).length;
  return { total, high, medium, low, needsReview };
};

const runPythonJsonProcess = <T,>(scriptPath: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXECUTABLE, [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Python process timed out for ${path.basename(scriptPath)}`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${path.basename(scriptPath)} exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to parse Python JSON output'));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

const extractSelectableText = async (fileBuffer: Buffer) => {
  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: fileBuffer });
  const data = await parser.getText();
  await parser.destroy?.();
  return String(data.text || '').trim();
};

export async function detectPdfType(fileBuffer: Buffer): Promise<PdfType> {
  const rawText = await extractSelectableText(fileBuffer);
  if (!rawText) return 'scan';
  return detectTableLikeText(rawText) ? 'text-table' : 'text';
}

export async function extractTablesWithCamelot(fileBuffer: Buffer): Promise<CamelotExtractResult> {
  return runPythonJsonProcess<CamelotExtractResult>(CAMELOT_SCRIPT, {
    pdfBase64: fileBuffer.toString('base64'),
  }, PDF_PARSE_TIMEOUT_MS);
}

const hasMeaningfulNumbers = (row: CamelotExtractedRow) => {
  return [row.quantity, row.pricePerUnit, row.unitsPerBox, row.boxPrice].some((value) => normalizeNumber(value) > 0);
};

export function cleanAndNormalizeRows(rows: CamelotExtractedRow[]): CleanedStructuredRow[] {
  const merged: CamelotExtractedRow[] = [];

  for (const row of rows) {
    const name = normalizeTextValue(row.name);
    if (!name && !hasMeaningfulNumbers(row)) continue;

    const previous = merged[merged.length - 1];
    const isContinuation = !!previous && name && !hasMeaningfulNumbers(row);
    if (isContinuation) {
      previous.name = normalizeWhitespace(`${previous.name || ''} ${name}`);
      previous.rawCells = [...(previous.rawCells || []), ...(row.rawCells || [])];
      previous.issues = [...(previous.issues || []), ...(row.issues || [])];
      continue;
    }

    merged.push({
      ...row,
      name,
      unit: normalizeUnit(row.unit),
      rawCells: (row.rawCells || []).map((cell) => normalizeTextValue(cell)),
      issues: [...(row.issues || [])],
    });
  }

  return merged
    .map((row) => {
      const name = normalizeTextValue(row.name);
      const unit = normalizeUnit(row.unit);
      const quantity = Math.max(1, Math.round(normalizeNumber(row.quantity) || 1));
      const pricePerUnit = Math.max(0, Number(normalizeNumber(row.pricePerUnit).toFixed(2)));
      const unitsPerBox = Math.max(1, Math.round(normalizeNumber(row.unitsPerBox) || 1));
      const explicitBoxPrice = Math.max(0, Number(normalizeNumber(row.boxPrice).toFixed(2)));
      const expectedBoxPrice = Number((pricePerUnit * unitsPerBox).toFixed(2));
      const boxPrice = explicitBoxPrice > 0 ? explicitBoxPrice : expectedBoxPrice;
      const delta = Number((boxPrice - expectedBoxPrice).toFixed(2));
      const warnings = [...(row.issues || [])];

      if (!name) warnings.push('Missing product name');
      if (pricePerUnit <= 0 && boxPrice <= 0) warnings.push('Missing pricing');
      if (Math.abs(delta) > 0.01) warnings.push(`Box price delta ${delta.toFixed(2)}`);

      return {
        name,
        unit,
        quantity,
        pricePerUnit,
        unitsPerBox,
        boxPrice,
        expectedBoxPrice,
        delta,
        status: warnings.length > 0 ? 'CHECK' : 'OK',
        warnings,
      } satisfies CleanedStructuredRow;
    })
    .filter((row) => row.name);
}

export function convertToOcrFormat(params: {
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  rawText: string;
  rows: CleanedStructuredRow[];
  issues?: string[];
}): OcrResult {
  const items: OcrResultItem[] = params.rows.map((row) => {
    const costPrice = row.pricePerUnit > 0
      ? row.pricePerUnit
      : row.unitsPerBox > 0 && row.boxPrice > 0
        ? Number((row.boxPrice / row.unitsPerBox).toFixed(2))
        : row.boxPrice;

    const warnings = [...row.warnings];
    const confidence: OcrConfidence = warnings.length === 0 ? 'HIGH' : 'MEDIUM';

    return {
      name: row.name,
      quantity: Math.max(1, row.quantity),
      costPrice: Math.max(0, Number(costPrice.toFixed(2))),
      lineTotal: row.boxPrice > 0 ? row.boxPrice : undefined,
      confidence,
      warnings: warnings.length ? warnings.join('; ') : undefined,
      needsReview: row.status === 'CHECK',
    };
  });

  return {
    invoiceNumber: params.invoiceNumber,
    supplierName: params.supplierName,
    invoiceDate: params.invoiceDate,
    rawText: params.rawText,
    items,
    confidenceSummary: buildConfidenceSummary(items),
  };
}

const renderPdfPageForVision = async (fileBuffer: Buffer) =>
  runPythonJsonProcess<RenderedPdfPage>(PDF_RENDER_SCRIPT, {
    pdfBase64: fileBuffer.toString('base64'),
  }, PDF_RENDER_TIMEOUT_MS);

export async function processPdfDocument(pdfBase64: string): Promise<ProcessPdfDocumentResult> {
  const fileBuffer = Buffer.from(pdfBase64, 'base64');
  const warnings: string[] = [];
  const rawText = await extractSelectableText(fileBuffer).catch(() => '');
  const pdfType = rawText ? (detectTableLikeText(rawText) ? 'text-table' : 'text') : 'scan';

  console.info(`[OCR] PDF type detected: ${pdfType}`);

  if (pdfType === 'text-table') {
    try {
      const extracted = await extractTablesWithCamelot(fileBuffer);
      console.info(`[OCR] Camelot extraction flavor=${extracted.flavor} tables=${extracted.tableCount} rows=${extracted.rows.length}`);
      const cleanedRows = cleanAndNormalizeRows(extracted.rows);
      if (cleanedRows.length > 0) {
        const header = extractHeader(rawText || extracted.rawTableText || '');
        const result = convertToOcrFormat({
          invoiceNumber: header.invoiceNumber,
          supplierName: header.supplierName,
          invoiceDate: header.invoiceDate,
          rawText: rawText || extracted.rawTableText || '',
          rows: cleanedRows,
          issues: extracted.issues,
        });

        return {
          pdfType,
          engine: 'pdf+camelot',
          result,
          warnings: extracted.issues || [],
        };
      }

      warnings.push('Camelot returned no usable rows');
      console.warn('[OCR] Camelot returned no usable rows, falling back to legacy PDF normalization');
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Camelot extraction failed');
      console.warn('[OCR] Camelot extraction failed, falling back to legacy PDF normalization');
    }
  }

  if (pdfType === 'scan') {
    try {
      const renderedPage = await renderPdfPageForVision(fileBuffer);
      const result = await runOllamaVisionOcr(renderedPage.imageBase64, renderedPage.mimeType || 'image/png');
      return {
        pdfType,
        engine: 'pdf+vision+ollama',
        result: {
          ...result,
          confidenceSummary: buildConfidenceSummary(result.items),
        },
        warnings,
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'PDF render fallback failed');
      console.warn('[OCR] PDF render fallback failed, using legacy PDF parser');
    }
  }

  if (rawText) {
    const normalized = await runOllamaTextNormalization(rawText);
    return {
      pdfType,
      engine: 'pdf+ollama',
      result: {
        ...normalized,
        confidenceSummary: buildConfidenceSummary(normalized.items),
      },
      warnings,
    };
  }

  const legacy = await runPdfOcr(pdfBase64);
  return {
    pdfType,
    engine: 'pdf+legacy',
    result: {
      ...legacy,
      confidenceSummary: buildConfidenceSummary(legacy.items),
    },
    warnings,
  };
}