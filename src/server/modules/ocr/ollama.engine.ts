import type { OcrResult } from './ocr.types';

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_OCR_MODEL || 'gemma3:4b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 90000);

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

type ParsedInvoiceItem = OcrResult['items'][number];

const normalizeNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const source = String(value ?? '').trim();
  if (!source) return 0;
  const cleaned = source.replace(/\s/g, '');
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return Number(cleaned.replace(',', '.')) || 0;
};

const firstString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = String(record[key] || '').trim();
    if (value) return value;
  }
  return '';
};

const firstNumber = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = normalizeNumber(record[key]);
    if (value > 0) return value;
  }
  return 0;
};

const normalizeDateString = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0];
};

const safeJsonFromText = <T,>(raw: string): T | null => {
  const markdownMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  const source = markdownMatch?.[1] ?? raw;
  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as T;
  } catch {
    return null;
  }
};

const normalizeItems = (items: unknown): ParsedInvoiceItem[] => {
  if (!Array.isArray(items)) return [];
  const normalized: ParsedInvoiceItem[] = [];
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const name = firstString(record, ['name', 'title', 'productName', 'itemName']);
    if (!name) continue;
    const quantity = Math.max(1, Math.round(firstNumber(record, ['quantity', 'qty', 'count']) || 1));
    const lineTotal = firstNumber(record, ['lineTotal', 'total', 'sum', 'amount', 'totalPrice']);
    const directCost = firstNumber(record, ['costPrice', 'price', 'unitPrice', 'purchasePrice']);
    const costPrice = directCost > 0 ? directCost : lineTotal > 0 && quantity > 0 ? lineTotal / quantity : 0;
    normalized.push({
      name,
      sku: firstString(record, ['sku', 'code', 'article']) || undefined,
      barcode: firstString(record, ['barcode', 'ean']) || undefined,
      quantity,
      costPrice: Math.max(0, Number(costPrice.toFixed(2))),
      lineTotal: lineTotal > 0 ? Number(lineTotal.toFixed(2)) : undefined,
      batchNumber: String(record.batchNumber || '').trim() || undefined,
      expiryDate: normalizeDateString(firstString(record, ['expiryDate', 'expiry', 'expDate', 'expirationDate'])) || undefined,
    });
  }
  return normalized;
};

const buildImagePrompt = () => [
  'Ты распознаешь приходные накладные аптеки.',
  'Чаще всего в накладной есть номер, название товара, срок годности, количество, цена и сумма.',
  'Игнорируй номер строки, внутренний код товара, отметки ручкой, подписи и печати.',
  'Партию не выдумывай: если ее нет явно, верни пустую строку.',
  'Если есть количество и сумма, но нет отдельной цены, посчитай costPrice = sum / quantity.',
  'Извлеки данные со скана и верни только JSON без пояснений.',
  'Строгая схема ответа:',
  '{',
  '  "invoiceNumber": "string",',
  '  "supplierName": "string",',
  '  "invoiceDate": "YYYY-MM-DD",',
  '  "items": [',
  '    {',
  '      "name": "string",',
  '      "sku": "string optional",',
  '      "barcode": "string optional",',
  '      "quantity": number,',
  '      "costPrice": number,',
  '      "lineTotal": number optional,',
  '      "batchNumber": "string optional",',
  '      "expiryDate": "YYYY-MM-DD optional"',
  '    }',
  '  ]',
  '}',
  'Если поле неизвестно, верни пустую строку для строк и 0 для чисел.',
  'Для items бери только товарные строки, где есть название и хотя бы количество с ценой или суммой.',
].join('\n');

const buildTextPrompt = (rawText: string) => [
  'Ты приводишь текст аптечной накладной к строгому JSON.',
  'На входе уже извлеченный текст документа.',
  'Чаще всего в тексте есть номер, название товара, срок годности, количество, цена и сумма.',
  'Игнорируй номер строки, служебные коды, подписи, печати, блоки с подписями и общие итоги документа.',
  'Партию не выдумывай: если ее нет явно, верни пустую строку.',
  'Если есть quantity и lineTotal/sum, но нет costPrice, вычисли costPrice = lineTotal / quantity.',
  'Верни только JSON без пояснений по схеме:',
  '{',
  '  "invoiceNumber": "string",',
  '  "supplierName": "string",',
  '  "invoiceDate": "YYYY-MM-DD",',
  '  "items": [',
  '    {',
  '      "name": "string",',
  '      "sku": "string optional",',
  '      "barcode": "string optional",',
  '      "quantity": number,',
  '      "costPrice": number,',
  '      "lineTotal": number optional,',
  '      "batchNumber": "string optional",',
  '      "expiryDate": "YYYY-MM-DD optional"',
  '    }',
  '  ]',
  '}',
  'Если поле неизвестно, верни пустую строку для строк и 0 для чисел.',
  '',
  'Текст документа:',
  rawText,
].join('\n');

const callOllama = async (content: string, images?: string[]) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'user',
            content,
            ...(images && images.length > 0 ? { images } : {}),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(raw || `Ollama returned status ${response.status}`);
    }

    return await response.json() as OllamaChatResponse;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeOllamaResult = (content: string, rawText = ''): OcrResult => {
  const parsed = safeJsonFromText<{
    invoiceNumber?: string;
    supplierName?: string;
    invoiceDate?: string;
    items?: unknown;
  }>(content);

  return {
    invoiceNumber: String(parsed?.invoiceNumber || '').trim(),
    supplierName: String(parsed?.supplierName || '').trim(),
    invoiceDate: normalizeDateString(parsed?.invoiceDate) || new Date().toISOString().split('T')[0],
    rawText: rawText || content,
    items: normalizeItems(parsed?.items),
  };
};

export const getOllamaModelName = () => OLLAMA_MODEL;

export const checkOllamaAvailability = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export async function runOllamaVisionOcr(imageBase64: string, _mimeType: string): Promise<OcrResult> {
  const response = await callOllama(buildImagePrompt(), [imageBase64]);
  const content = response.message?.content || '';
  return normalizeOllamaResult(content);
}

export async function runOllamaTextNormalization(rawText: string): Promise<OcrResult> {
  const response = await callOllama(buildTextPrompt(rawText));
  const content = response.message?.content || '';
  return normalizeOllamaResult(content, rawText);
}