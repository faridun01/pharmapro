import { Supplier } from '../core/domain';

export interface InvoiceImportItem {
  lineId: string;
  productId: string | null;
  name: string;
  sku?: string;
  barcode?: string;
  quantity: number;
  unitsInPack: number;
  costPrice: number;
  batchNumber: string;
  expiryDate: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  warnings?: string;
  needsReview?: boolean;
}

export interface OcrAnalyzeResponse {
  engine: string;
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  rawText?: string;
  review?: { total: number; high: number; medium: number; low: number; needsReview: number };
  items: Array<{
    lineId?: string;
    productId?: string | null;
    name: string;
    sku?: string;
    barcode?: string;
    quantity: number;
    costPrice: number;
    batchNumber?: string;
    expiryDate?: string;
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
    warnings?: string;
    needsReview?: boolean;
  }>;
  warning?: string;
}

export type ImportFileKind = 'image' | 'pdf' | 'excel' | 'unsupported';

export const randomBatch = () => `B-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const buildItemIdentity = (item: Pick<InvoiceImportItem, 'name' | 'expiryDate' | 'costPrice'>) => {
  return [
    item.name.trim().toLowerCase(),
    item.expiryDate || '',
    Number(item.costPrice || 0).toFixed(2),
  ].join('::');
};

export const isPlaceholderItemName = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;

  return [
    'тестовый препарат',
    'test product',
    'sample product',
    'demo product',
    'placeholder product',
  ].some((token) => normalized.includes(token));
};

export const isImportablePreviewItem = (item: Partial<InvoiceImportItem>) => {
  return !isPlaceholderItemName(String(item.name || ''))
    && Number(item.quantity || 0) > 0
    && Number(item.costPrice || 0) > 0;
};

export const formatVisibleError = (message: string | null) => {
  if (!message) return null;

  const parserValidationMarkers = [
    'Missing product name',
    'Quantity could not be parsed',
    'Cost price could not be parsed',
    'Quantity must be >= 1',
    'Cost price must be numeric and > 0',
  ];

  if (parserValidationMarkers.some((marker) => message.includes(marker))) {
    return 'Не удалось корректно распознать позиции накладной. Проверьте файл или загрузите более четкое изображение.';
  }

  return message;
};

export const toBase64 = async (file: File): Promise<string> => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) throw new Error('empty-file');
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  } catch {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.split(',')[1];
        if (!base64) {
          reject(new Error(`Не удалось прочитать файл: ${file.name}`));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error(`Не удалось прочитать файл: ${file.name}`));
      reader.readAsDataURL(file);
    });
  }
};

export const detectImportFileKind = (file: File): ImportFileKind => {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    return 'excel';
  }

  if (fileName.endsWith('.pdf') || mimeType === 'application/pdf') {
    return 'pdf';
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  return 'unsupported';
};

export const findSupplierByName = (candidate: string, suppliers: Supplier[]) => {
  const normalizedCandidate = String(candidate || '').trim().toLowerCase();
  if (!normalizedCandidate) return null;

  return suppliers.find(
    (supplier) =>
      supplier.name.toLowerCase().includes(normalizedCandidate) ||
      normalizedCandidate.includes(supplier.name.toLowerCase()),
  ) || null;
};

export const requestStructuredPreview = async (file: File): Promise<OcrAnalyzeResponse> => {
  const fileBase64 = await toBase64(file);
  const token = localStorage.getItem('pharmapro_token');
  const response = await fetch('/api/invoices/ocr/structured-preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      fileBase64,
      fileName: file.name,
      mimeType: file.type,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Не удалось обработать файл поставщика');
  }

  return body as OcrAnalyzeResponse;
};

export const requestImageOcr = async (file: File): Promise<OcrAnalyzeResponse> => {
  const imageBase64 = await toBase64(file);
  const token = localStorage.getItem('pharmapro_token');
  const response = await fetch('/api/invoices/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ imageBase64, mimeType: file.type || 'image/png', engine: 'ollama' }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Не удалось проанализировать накладную');
  }

  return await response.json() as OcrAnalyzeResponse;
};
