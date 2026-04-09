import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Trash2, FileText, Truck, Calendar, CheckCircle2, AlertCircle, Search, Pill, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePharmacy } from '../context';
import { loadXlsx } from '../../lib/lazyLoaders';
import { useDebounce } from '../../lib/useDebounce';

interface ImportInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface InvoiceImportItem {
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

interface OcrAnalyzeResponse {
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

const randomBatch = () => `B-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const buildGeneratedInvoiceNumber = (prefix = 'PINV-XL') => {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');

  return [
    prefix,
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join('-');
};

const buildItemIdentity = (item: Pick<InvoiceImportItem, 'name' | 'expiryDate' | 'costPrice'>) => {
  return [
    item.name.trim().toLowerCase(),
    item.expiryDate || '',
    Number(item.costPrice || 0).toFixed(2),
  ].join('::');
};

export const ImportInvoiceModal: React.FC<ImportInvoiceModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { suppliers, products, importPurchaseInvoice, refreshProducts, createProduct } = usePharmacy();

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState<InvoiceImportItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [usedEngine, setUsedEngine] = useState<string | null>(null);
  const [ocrDraftId, setOcrDraftId] = useState<string | null>(null);
  const [reviewSummary, setReviewSummary] = useState<{ total: number; high: number; medium: number; low: number; needsReview: number } | null>(null);
  const [rawOcrText, setRawOcrText] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);
  const [ocrJsonResponse, setOcrJsonResponse] = useState<OcrAnalyzeResponse | null>(null);
  const [showOcrJson, setShowOcrJson] = useState(false);
  const [pendingOcrItems, setPendingOcrItems] = useState<InvoiceImportItem[] | null>(null);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelPreviewItems, setExcelPreviewItems] = useState<InvoiceImportItem[] | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);

  // Debounce search to 300ms to avoid filtering on every keystroke
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || p.sku.toLowerCase().includes(debouncedSearchTerm.toLowerCase()),
  );

  const addItem = (product: any) => {
    const existing = items.find((i) => i.productId === product.id);
    if (existing) return;
    setItems([
      ...items,
      {
        lineId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        quantity: 1,
        unitsInPack: 1,
        costPrice: product.costPrice,
        batchNumber: `B-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    ]);
    setSearchTerm('');
  };

  const removeItem = (lineId: string) => {
    setItems(items.filter((i) => i.lineId !== lineId));
  };

  const updateItem = (lineId: string, field: keyof InvoiceImportItem, value: any) => {
    setItems(items.map((i) => (i.lineId === lineId ? { ...i, [field]: value } : i)));
  };

  const grossTotal = items.reduce((acc, i) => acc + i.quantity * i.unitsInPack * i.costPrice, 0);
  const netTotal = Math.max(0, grossTotal - discountAmount);

  const toBase64 = async (file: File): Promise<string> => {
    // Prefer arrayBuffer because FileReader can sporadically fail in packaged Electron.
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

  const normalizeHeader = (value: unknown) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[қќ]/g, 'к')
      .replace(/[ҳ]/g, 'х')
      .replace(/[ғ]/g, 'г')
      .replace(/[ҷ]/g, 'ж')
      .replace(/[ӯ]/g, 'у')
      .replace(/[ӣ]/g, 'и')
      .replace(/[ё]/g, 'е')
      .replace(/[\s_\-./\\()]/g, '')
      .trim();

  const HEADER_ALIASES = {
    name: ['наименование', 'наименованиетовара', 'название', 'названиетовара', 'товар', 'product', 'name', 'номенклатура', 'номгу', 'номи', 'номимавод', 'номидору'],
    sku: ['артикул', 'sku', 'код', 'кодтовара', 'внутреннийкод'],
    barcode: ['штрихкод', 'штрихкодтовара', 'штрих-код', 'barcode', 'ean'],
    quantity: ['колво', 'количество', 'кол', 'qty', 'quantity', 'упаковки', 'количествоупаковок', 'микдор', 'миқдор', 'шумора', 'количествоупаковок'],
    unitsInPack: ['едвупаковке', 'штуквупаковке', 'unitsinpack', 'packqty', 'фасовка', 'вупаковке'],
    cost: ['цена', 'ценазакупки', 'закупочнаяцена', 'ценапоступления', 'price', 'unitprice', 'cost', 'costprice', 'нарх', 'нархивохид', 'закупочнаястоимость'],
    total: ['сумма', 'итого', 'amount', 'total', 'linetotal', 'суммастроки', 'суммасндс', 'хамаги', 'ҳамагӣ', 'чами', 'итоговаясумма'],
    batch: ['серия', 'партия', 'batch', 'batchnumber', 'серияпартия', 'силсила'],
    expiry: ['срокгодности', 'годендодо', 'годендo', 'годендо', 'expiry', 'expirydate', 'срок', 'датагодности', 'мухлат', 'мухлатиистифода', 'мухлатгодности', 'санаианчом'],
  } as const;

  const EXCEL_METADATA_ALIASES = {
    supplier: ['поставщик', 'поставщикорганизация', 'контрагент', 'supplier', 'vendor', 'vendorname'],
    invoiceNumber: ['номернакладной', 'номер', 'документ', 'номердокумента', 'invoice', 'invoicenumber', 'billnumber'],
    invoiceDate: ['датанакладной', 'дата', 'датадокумента', 'invoicedate', 'documentdate'],
  } as const;

  const normalizeSpreadsheetNumber = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

    const source = String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .trim();
    if (!source) return 0;

    const numericCandidate = source
      .replace(/[^\d,.-]+/g, '')
      .replace(/(,)(?=.*[,])/g, '')
      .replace(/(\.)(?=.*[.])/g, '');

    if (!numericCandidate) return 0;

    const lastComma = numericCandidate.lastIndexOf(',');
    const lastDot = numericCandidate.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      const normalized = decimalSeparator === ','
        ? numericCandidate.replace(/\./g, '').replace(',', '.')
        : numericCandidate.replace(/,/g, '');
      return Number(normalized) || 0;
    }

    if (lastComma >= 0) {
      return Number(numericCandidate.replace(',', '.')) || 0;
    }

    return Number(numericCandidate) || 0;
  };

  const excelSerialDateToIso = (serial: number) => {
    if (!Number.isFinite(serial) || serial <= 0) return '';
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    if (Number.isNaN(dateInfo.getTime())) return '';
    return dateInfo.toISOString().slice(0, 10);
  };

  const normalizeSpreadsheetDate = (value: unknown) => {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      return value.toISOString().slice(0, 10);
    }

    if (typeof value === 'number') {
      return excelSerialDateToIso(value);
    }

    const source = String(value ?? '').trim();
    if (!source) return '';

    const dayMonthYear = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (dayMonthYear) {
      const [, day, month, year] = dayMonthYear;
      const normalizedYear = year.length === 2 ? `20${year}` : year;
      return `${normalizedYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const monthYear = source.match(/^(\d{1,2})[./-](\d{2,4})$/);
    if (monthYear) {
      const [, month, year] = monthYear;
      const normalizedYear = year.length === 2 ? `20${year}` : year;
      return `${normalizedYear}-${month.padStart(2, '0')}-01`;
    }

    const yearMonth = source.match(/^(\d{4})[./-](\d{1,2})$/);
    if (yearMonth) {
      const [, year, month] = yearMonth;
      return `${year}-${month.padStart(2, '0')}-01`;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
      return source;
    }

    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  };

  const matchesHeaderAlias = (header: string, aliases: readonly string[]) => {
    const normalizedHeader = normalizeHeader(header);
    if (!normalizedHeader) return false;

    return aliases.some((alias) => {
      const normalizedAlias = normalizeHeader(alias);
      if (!normalizedAlias) return false;
      return normalizedHeader === normalizedAlias || normalizedHeader.includes(normalizedAlias);
    });
  };

  const findColumnIndex = (headers: string[], aliases: string[]) => {
    return headers.findIndex((header) => matchesHeaderAlias(header, aliases));
  };

  const findSupplierByName = (candidate: string) => {
    const normalizedCandidate = String(candidate || '').trim().toLowerCase();
    if (!normalizedCandidate) return null;

    return suppliers.find(
      (supplier) =>
        supplier.name.toLowerCase().includes(normalizedCandidate) ||
        normalizedCandidate.includes(supplier.name.toLowerCase()),
    ) || null;
  };

  const extractMetadataValueFromRow = (row: unknown[], aliases: readonly string[]) => {
    for (let index = 0; index < row.length; index += 1) {
      const rawCell = String(row[index] ?? '').trim();
      if (!rawCell) continue;

      if (!matchesHeaderAlias(rawCell, aliases)) continue;

      const inlineMatch = rawCell.match(/[:=]\s*(.+)$/);
      if (inlineMatch?.[1]?.trim()) {
        return inlineMatch[1].trim();
      }

      for (let nextIndex = index + 1; nextIndex < row.length; nextIndex += 1) {
        const siblingValue = String(row[nextIndex] ?? '').trim();
        if (siblingValue) return siblingValue;
      }
    }

    return '';
  };

  const extractExcelMetadata = (rows: unknown[][], headerRowIndex: number) => {
    const metadataRows = rows.slice(0, Math.max(headerRowIndex, 8));
    const metadata = {
      supplierName: '',
      invoiceNumber: '',
      invoiceDate: '',
    };

    for (const row of metadataRows) {
      if (!metadata.supplierName) {
        metadata.supplierName = extractMetadataValueFromRow(row, EXCEL_METADATA_ALIASES.supplier);
      }
      if (!metadata.invoiceNumber) {
        metadata.invoiceNumber = extractMetadataValueFromRow(row, EXCEL_METADATA_ALIASES.invoiceNumber);
      }
      if (!metadata.invoiceDate) {
        metadata.invoiceDate = extractMetadataValueFromRow(row, EXCEL_METADATA_ALIASES.invoiceDate);
      }
    }

    return {
      supplierName: metadata.supplierName,
      invoiceNumber: metadata.invoiceNumber,
      invoiceDate: normalizeSpreadsheetDate(metadata.invoiceDate),
    };
  };

  const pickHeaderRow = (rows: any[][]) => {
    const scanRows = rows.slice(0, 8);
    let bestIndex = 0;
    let bestScore = -1;

    scanRows.forEach((row, rowIndex) => {
      const headers = (row || []).map((cell) => String(cell || ''));
      const score = [
        findColumnIndex(headers, [...HEADER_ALIASES.name]),
        findColumnIndex(headers, [...HEADER_ALIASES.quantity]),
        findColumnIndex(headers, [...HEADER_ALIASES.expiry]),
        Math.max(findColumnIndex(headers, [...HEADER_ALIASES.cost]), findColumnIndex(headers, [...HEADER_ALIASES.total])),
      ].filter((idx) => idx >= 0).length;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = rowIndex;
      }
    });

    return bestIndex;
  };

  const handleAnalyzeExcel = async () => {
    if (!excelFile) {
      setError('Сначала выберите Excel-файл');
      return;
    }

    try {
      setAnalyzing(true);
      setError(null);

      const XLSX = await loadXlsx();
      const buffer = await excelFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error('Excel-файл не содержит листов');

      const sheet = workbook.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true, defval: '' });
      if (!rows.length) throw new Error('Excel-файл пустой');

      const headerRowIndex = pickHeaderRow(rows);
      const metadata = extractExcelMetadata(rows, headerRowIndex);
      const headers = (rows[headerRowIndex] || []).map((h) => String(h || ''));
      const nameIdx = findColumnIndex(headers, [...HEADER_ALIASES.name]);
      const skuIdx = findColumnIndex(headers, [...HEADER_ALIASES.sku]);
      const barcodeIdx = findColumnIndex(headers, [...HEADER_ALIASES.barcode]);
      const qtyIdx = findColumnIndex(headers, [...HEADER_ALIASES.quantity]);
      const unitsIdx = findColumnIndex(headers, [...HEADER_ALIASES.unitsInPack]);
      const costIdx = findColumnIndex(headers, [...HEADER_ALIASES.cost]);
      const totalIdx = findColumnIndex(headers, [...HEADER_ALIASES.total]);
      const batchIdx = findColumnIndex(headers, [...HEADER_ALIASES.batch]);
      const expiryIdx = findColumnIndex(headers, [...HEADER_ALIASES.expiry]);

      if (nameIdx < 0 || qtyIdx < 0 || expiryIdx < 0 || (costIdx < 0 && totalIdx < 0)) {
        const visibleHeaders = headers.filter((header) => String(header || '').trim()).join(', ');
        throw new Error(`Не найдены обязательные колонки: Наименование, Количество, Срок годности, Цена или Сумма. Найдены заголовки: ${visibleHeaders || 'нет данных'}`);
      }

      const nextItems: InvoiceImportItem[] = [];
      const skippedReasons = { missingName: 0, invalidQuantity: 0, invalidPrice: 0 };
      const bodyRows = rows.slice(headerRowIndex + 1);
      for (let r = 0; r < bodyRows.length; r += 1) {
        const row = bodyRows[r] || [];
        const name = String(row[nameIdx] || '').trim();
        if (!name) {
          skippedReasons.missingName += 1;
          continue;
        }

        const quantity = Math.max(0, normalizeSpreadsheetNumber(row[qtyIdx] || 0));
        const unitsInPack = Math.max(1, normalizeSpreadsheetNumber(unitsIdx >= 0 ? row[unitsIdx] : 1) || 1);
        const rawCostPrice = costIdx >= 0 ? Math.max(0, normalizeSpreadsheetNumber(row[costIdx] || 0)) : 0;
        const rawLineTotal = totalIdx >= 0 ? Math.max(0, normalizeSpreadsheetNumber(row[totalIdx] || 0)) : 0;
        const costPrice = rawCostPrice > 0
          ? rawCostPrice
          : quantity > 0
            ? Number((rawLineTotal / (quantity * unitsInPack || 1)).toFixed(2))
            : 0;
        if (quantity <= 0) {
          skippedReasons.invalidQuantity += 1;
          continue;
        }
        if (costPrice < 0 || (rawCostPrice <= 0 && rawLineTotal <= 0)) {
          skippedReasons.invalidPrice += 1;
          continue;
        }

        const sku = skuIdx >= 0 ? String(row[skuIdx] || '').trim() : '';
        const barcode = barcodeIdx >= 0 ? String(row[barcodeIdx] || '').trim() : '';
        const batchNumber = (batchIdx >= 0 ? String(row[batchIdx] || '').trim() : '') || randomBatch();

        const rawExpiryValue = expiryIdx >= 0 ? row[expiryIdx] : '';
        const rawExpiry = String(rawExpiryValue || '').trim();
        const expiryDate = normalizeSpreadsheetDate(rawExpiryValue);
        if (!expiryDate) {
          throw new Error(`В Excel строка ${r + 2}: срок годности обязателен и должен быть датой. Значение: ${rawExpiry || '<пусто>'}`);
        }

        const matchedProduct = products.find((p) => {
          if (barcode && p.barcode && p.barcode === barcode) return true;
          if (sku && p.sku && p.sku.toLowerCase() === sku.toLowerCase()) return true;
          return p.name.toLowerCase() === name.toLowerCase();
        });

        nextItems.push({
          lineId: `excel-${Date.now()}-${r}`,
          productId: matchedProduct?.id || null,
          name,
          sku,
          barcode,
          quantity,
          unitsInPack,
          costPrice,
          batchNumber,
          expiryDate,
          confidence: 'MEDIUM',
          warnings: matchedProduct ? '' : 'Товар не найден в каталоге, будет создан при импорте',
          needsReview: !matchedProduct,
        });
      }

      if (!nextItems.length) {
        throw new Error(`В Excel не найдено валидных строк для импорта. Пропущено: без названия ${skippedReasons.missingName}, без количества ${skippedReasons.invalidQuantity}, без цены/суммы ${skippedReasons.invalidPrice}`);
      }

      if (metadata.supplierName) {
        const matchedSupplier = findSupplierByName(metadata.supplierName);
        if (matchedSupplier) setSupplierId(matchedSupplier.id);
      }

      if (metadata.invoiceNumber) {
        setInvoiceNumber(metadata.invoiceNumber);
      }

      if (metadata.invoiceDate) {
        setDate(metadata.invoiceDate);
      }

      setExcelPreviewItems(nextItems);
    } catch (e: any) {
      setError(e?.message || 'Не удалось обработать Excel-файл');
      setExcelPreviewItems(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmExcelPreview = () => {
    if (!excelPreviewItems?.length) return;
    const existing = new Set(items.map((i) => buildItemIdentity(i)));
    const unique = excelPreviewItems.filter((i) => !existing.has(buildItemIdentity(i)));
    setItems((prev) => [...prev, ...unique]);
    if (!invoiceNumber.trim()) {
      setInvoiceNumber(buildGeneratedInvoiceNumber());
    }
    setExcelPreviewItems(null);
    setExcelFile(null);
  };

  const confirmOcrJson = () => {
    if (!pendingOcrItems?.length) return;
    const existing = new Set(items.map((i) => buildItemIdentity(i)));
    const unique = pendingOcrItems.filter((i) => !existing.has(buildItemIdentity(i)));
    setItems((prev) => [...prev, ...unique]);
    setPendingOcrItems(null);
  };

  const discardOcrJson = () => {
    setPendingOcrItems(null);
    setOcrJsonResponse(null);
    setShowOcrJson(false);
    setJsonCopied(false);
    setRawOcrText(null);
    setShowRawText(false);
    setReviewSummary(null);
    setUsedEngine(null);
  };

  const copyOcrJson = async () => {
    if (!ocrJsonResponse) return;
    await navigator.clipboard.writeText(JSON.stringify(ocrJsonResponse, null, 2));
    setJsonCopied(true);
    window.setTimeout(() => setJsonCopied(false), 1500);
  };

  const downloadOcrJson = () => {
    if (!ocrJsonResponse) return;
    const jsonText = JSON.stringify(ocrJsonResponse, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const fileLabel = (invoiceNumber || ocrJsonResponse.invoiceNumber || 'ocr-result')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    anchor.href = url;
    anchor.download = `${fileLabel || 'ocr-result'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleAnalyzeInvoice = async () => {
    if (!invoiceFile) {
      setError(t('Select invoice image first'));
      return;
    }

    try {
      setAnalyzing(true);
      setError(null);
      setRawOcrText(null);
      setShowRawText(false);
      setOcrJsonResponse(null);
      setShowOcrJson(true);
      setPendingOcrItems(null);
      setJsonCopied(false);
      setOcrDraftId(null);

      const imageBase64 = await toBase64(invoiceFile);
      const mimeType = invoiceFile.type === 'application/pdf' ? 'application/pdf' : invoiceFile.type || 'image/png';
      const token = localStorage.getItem('pharmapro_token');

      const response = await fetch('/api/invoices/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ imageBase64, mimeType, engine: 'ollama' }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t('Failed to analyze invoice'));
      }

      const data: OcrAnalyzeResponse = await response.json();
      setOcrJsonResponse(data);
      setUsedEngine(data.engine ?? null);
      setReviewSummary(data.review ?? null);
      if (data.rawText) setRawOcrText(data.rawText);

      if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
      if (data.invoiceDate) setDate(data.invoiceDate);

      if (data.supplierName) {
        const foundSupplier = findSupplierByName(data.supplierName);
        if (foundSupplier) setSupplierId(foundSupplier.id);
      }

      const parsedItems: InvoiceImportItem[] = (data.items || []).map((item: any, index: number) => ({
        lineId: item.lineId || `ocr-${Date.now()}-${index}`,
        productId: item.productId || null,
        name: item.name,
        sku: item.sku || '',
        barcode: item.barcode || '',
        quantity: Number(item.quantity) || 1,
        unitsInPack: 1,
        costPrice: Number(item.costPrice) || 0,
        batchNumber: item.batchNumber || `B-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        expiryDate: item.expiryDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        confidence: item.confidence,
        warnings: item.warnings || '',
        needsReview: !!item.needsReview,
      }));

      if (parsedItems.length === 0) {
        setError(data.warning || t('No invoice items recognized'));
        setPendingOcrItems(null);
        return;
      }

      setPendingOcrItems(parsedItems);
    } catch (err: any) {
      setError(err.message || t('Failed to analyze invoice'));
    } finally {
      setAnalyzing(false);
    }
  };

  const resetFormAndClose = () => {
    setSuccess(false);
    onClose();
    setItems([]);
    setSupplierId('');
    setInvoiceNumber('');
    setInvoiceFile(null);
    setOcrDraftId(null);
    setReviewSummary(null);
    setRawOcrText(null);
    setShowRawText(false);
    setOcrJsonResponse(null);
    setShowOcrJson(false);
    setPendingOcrItems(null);
    setJsonCopied(false);
    setExcelFile(null);
    setExcelPreviewItems(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !invoiceNumber.trim() || !date || items.length === 0 || pendingOcrItems?.length) return;

    setProcessing(true);
    setError(null);
    try {
      if (ocrDraftId) {
        const token = localStorage.getItem('pharmapro_token');
        const response = await fetch(`/api/invoices/ocr/drafts/${ocrDraftId}/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            supplierId,
            invoiceNumber,
            invoiceDate: date,
            createMissingProducts: true,
            items: items.map((item) => ({
              ...item,
              quantity: item.quantity * item.unitsInPack,
            })),
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || t('Failed to import OCR draft'));
        }

        await refreshProducts();
        setSuccess(true);
        setTimeout(resetFormAndClose, 1200);
        return;
      }

      const selectedSupplier = suppliers.find((s) => s.id === supplierId);

      const createSku = (name: string) => {
        const base = name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 20);
        return `${base || 'ITEM'}-${Date.now().toString().slice(-5)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      };

      const importItems = [];

      for (const item of items) {
        let productId = item.productId;

        if (!productId) {
          const createdProduct = await createProduct({
            id: '',
            name: item.name,
            sku: item.sku?.trim() || createSku(item.name),
            barcode: item.barcode?.trim() || undefined,
            category: 'Imported',
            manufacturer: selectedSupplier?.name || 'Invoice Import',
            minStock: 10,
            costPrice: item.costPrice || 0,
            sellingPrice: Number((item.costPrice * 1.35).toFixed(2)),
            image: '',
            prescription: false,
            markingRequired: false,
          });
          productId = createdProduct.id;
        }

        importItems.push({
          productId,
          batchNumber: item.batchNumber?.trim() || randomBatch(),
          quantity: item.quantity * item.unitsInPack,
          unit: 'units',
          costBasis: item.costPrice,
          manufacturedDate: new Date(date),
          expiryDate: new Date(item.expiryDate),
        });
      }

      await importPurchaseInvoice({
        supplierId,
        invoiceNumber,
        invoiceDate: date,
        discountAmount,
        items: importItems,
      });

      await refreshProducts();
      setSuccess(true);
      setTimeout(resetFormAndClose, 1200);
    } catch (err: any) {
      setError(err.message || t('Failed to import invoice'));
    } finally {
      setProcessing(false);
    }
  };

  const submitBlockers = [
    !supplierId ? 'выберите поставщика' : '',
    !invoiceNumber.trim() ? 'укажите номер накладной' : '',
    !date ? 'укажите дату накладной' : '',
    items.length === 0 ? 'добавьте хотя бы одну позицию' : '',
    pendingOcrItems?.length ? 'сначала подтвердите OCR JSON' : '',
  ].filter(Boolean);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#151619]/80 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            className="relative w-full max-w-5xl bg-white rounded-[2.5rem] shadow-2xl border border-[#5A5A40]/10 overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-8 border-b border-[#5A5A40]/5 flex items-center justify-between bg-[#f5f5f0]/30">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-[#5A5A40] rounded-2xl flex items-center justify-center text-white shadow-lg">
                  <Upload size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-[#5A5A40]">Импорт приходной накладной</h3>
                  <p className="text-xs text-[#5A5A40]/40 uppercase tracking-widest font-bold">Поступление нового товара от поставщика</p>
                </div>
              </div>
              <button onClick={onClose} className="p-3 text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-white rounded-2xl transition-all">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-3 bg-[#f5f5f0]/40 border border-[#5A5A40]/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <input type="file" accept="image/*,application/pdf" onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} className="text-xs" />
                  <button type="button" onClick={handleAnalyzeInvoice} disabled={!invoiceFile || analyzing} className="inline-flex items-center gap-2 px-4 py-2 bg-[#151619] text-white text-xs font-bold uppercase tracking-widest rounded-xl disabled:opacity-50">
                    <Sparkles size={14} />
                    {analyzing ? 'Обработка...' : 'Распознать фото или PDF'}
                  </button>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <span className="px-3 py-1.5 rounded-xl bg-white border border-[#5A5A40]/10 text-xs font-bold text-[#5A5A40]">
                      Ollama · gemma3:4b
                    </span>
                    {usedEngine && <span className="px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-emerald-100 text-emerald-700">{usedEngine === 'ollama' ? 'OLLAMA' : usedEngine === 'pdf+ollama' ? 'PDF + OLLAMA' : usedEngine}</span>}
                    {invoiceFile && <p className="text-xs text-[#5A5A40]/70 truncate max-w-44">{invoiceFile.name}</p>}
                  </div>
                  <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest md:basis-full">
                    Для фото и PDF ищутся: номер накладной, название, срок годности, количество, цена и сумма. Партия создается автоматически.
                  </p>
                </div>

                <div className="md:col-span-3 bg-[#f5f5f0]/40 border border-[#5A5A40]/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <input type="file" accept=".xlsx,.xls" onChange={(e) => setExcelFile(e.target.files?.[0] || null)} className="text-xs" />
                  <button
                    type="button"
                    onClick={handleAnalyzeExcel}
                    disabled={!excelFile || analyzing}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#2d4a2f] text-white text-xs font-bold uppercase tracking-widest rounded-xl disabled:opacity-50"
                  >
                    <FileText size={14} />
                    {analyzing ? 'Обработка...' : 'Распознать Excel'}
                  </button>
                  {excelFile && <p className="text-xs text-[#5A5A40]/70 truncate max-w-56">{excelFile.name}</p>}
                  <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest md:basis-full">Excel: обязательны колонки Наименование, Количество, Срок годности и Цена или Сумма. Партия создается автоматически.</p>
                </div>

                {excelPreviewItems && (
                  <div className="md:col-span-3 bg-white border border-[#2d4a2f]/20 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#2d4a2f]">Предпросмотр Excel</p>
                        <p className="text-xs text-[#5A5A40]/70">Найдено строк: {excelPreviewItems.length}. Проверьте перед добавлением.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setExcelPreviewItems(null)} className="px-3 py-1.5 text-xs rounded-lg border border-[#5A5A40]/20 text-[#5A5A40]">Отменить</button>
                        <button type="button" onClick={confirmExcelPreview} className="px-3 py-1.5 text-xs rounded-lg bg-[#2d4a2f] text-white font-bold">Подтвердить и добавить</button>
                      </div>
                    </div>

                    <div className="max-h-56 overflow-y-auto rounded-xl border border-[#5A5A40]/10">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#f5f5f0] text-[#5A5A40]/70 uppercase tracking-wider text-[10px]">
                            <th className="px-3 py-2">Наименование</th>
                            <th className="px-3 py-2">Срок</th>
                            <th className="px-3 py-2">Кол-во</th>
                            <th className="px-3 py-2">Цена</th>
                            <th className="px-3 py-2">Статус</th>
                          </tr>
                        </thead>
                        <tbody>
                          {excelPreviewItems.map((row) => (
                            <tr key={row.lineId} className="border-t border-[#5A5A40]/10">
                              <td className="px-3 py-2 font-semibold text-[#5A5A40]">{row.name}</td>
                              <td className="px-3 py-2">{row.expiryDate}</td>
                              <td className="px-3 py-2">{row.unitsInPack > 1 ? `${row.quantity} x ${row.unitsInPack}` : row.quantity}</td>
                              <td className="px-3 py-2">{row.costPrice}</td>
                              <td className="px-3 py-2">
                                {row.needsReview ? (
                                  <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Нужна проверка</span>
                                ) : (
                                  <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">OK</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {rawOcrText && (
                  <div className="md:col-span-3">
                    <button type="button" onClick={() => setShowRawText((v) => !v)} className="text-[10px] font-bold text-[#5A5A40]/50 uppercase tracking-widest hover:text-[#5A5A40] transition-colors">
                      {showRawText ? '▲ Скрыть текст OCR' : '▼ Показать распознанный текст'}
                    </button>
                    {showRawText && <pre className="mt-2 p-4 bg-[#151619]/5 rounded-2xl text-[11px] font-mono text-[#5A5A40]/70 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar border border-[#5A5A40]/10">{rawOcrText}</pre>}
                  </div>
                )}

                {ocrJsonResponse && (
                  <div className="md:col-span-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <button type="button" onClick={() => setShowOcrJson((v) => !v)} className="text-[10px] text-left font-bold text-[#5A5A40]/50 uppercase tracking-widest hover:text-[#5A5A40] transition-colors">
                        {showOcrJson ? '▲ Скрыть JSON OCR' : '▼ Показать JSON OCR'}
                      </button>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={copyOcrJson} className="px-3 py-1.5 text-[10px] rounded-lg border border-[#5A5A40]/20 text-[#5A5A40] font-bold uppercase tracking-widest">
                          {jsonCopied ? 'Скопировано' : 'Копировать JSON'}
                        </button>
                        <button type="button" onClick={downloadOcrJson} className="px-3 py-1.5 text-[10px] rounded-lg bg-[#2d4a2f] text-white font-bold uppercase tracking-widest">
                          Скачать JSON
                        </button>
                      </div>
                    </div>
                    {showOcrJson && (
                      <div className="mt-2 space-y-3">
                        <pre className="p-4 bg-[#151619] rounded-2xl text-[11px] font-mono text-[#e9e7d8] whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar border border-[#5A5A40]/10">
                          {JSON.stringify(ocrJsonResponse, null, 2)}
                        </pre>
                        {pendingOcrItems && pendingOcrItems.length > 0 && (
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-2xl border border-[#5A5A40]/10 bg-[#f5f5f0] p-4">
                            <p className="text-xs text-[#5A5A40]/75">
                              JSON прочитан. Проверьте его и подтвердите добавление {pendingOcrItems.length} позиций в накладную.
                            </p>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={discardOcrJson} className="px-3 py-2 text-xs rounded-lg border border-[#5A5A40]/20 text-[#5A5A40]">
                                Отклонить JSON
                              </button>
                              <button type="button" onClick={confirmOcrJson} className="px-3 py-2 text-xs rounded-lg bg-[#151619] text-white font-bold">
                                Подтвердить и добавить
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest ml-1">Поставщик</label>
                  <div className="relative group">
                    <Truck className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 text-sm outline-none appearance-none">
                      <option value="">Выберите поставщика</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest ml-1">Номер накладной</label>
                  <div className="relative group">
                    <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
                    <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-00000" required className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 text-sm outline-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest ml-1">Дата накладной</label>
                  <div className="relative group">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 text-sm outline-none" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#5A5A40] uppercase tracking-widest">Позиции накладной</h4>
                  {reviewSummary && (
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                      <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700">H: {reviewSummary.high}</span>
                      <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700">M: {reviewSummary.medium}</span>
                      <span className="px-2 py-1 rounded-lg bg-red-100 text-red-700">L: {reviewSummary.low}</span>
                      <span className="px-2 py-1 rounded-lg bg-[#151619] text-white">Review: {reviewSummary.needsReview}</span>
                    </div>
                  )}
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={14} />
                    <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Найти товар и добавить..." className="w-full pl-9 pr-4 py-2 bg-[#f5f5f0]/50 border-none rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#5A5A40]/20" />
                    {searchTerm && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-[#5A5A40]/10 z-10 max-h-48 overflow-y-auto custom-scrollbar">
                        {filteredProducts.map((p) => (
                          <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full text-left px-4 py-3 hover:bg-[#f5f5f0] transition-all flex items-center gap-3">
                            <Pill size={14} className="text-[#5A5A40]/40" />
                            <span className="text-xs font-bold text-[#5A5A40]">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-[#f5f5f0]/30 rounded-3xl border border-[#5A5A40]/5 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#f5f5f0]/50 text-[10px] uppercase tracking-widest text-[#5A5A40]/50 font-bold">
                        <th className="px-4 py-4">№ ({items.length})</th>
                        <th className="px-4 py-4">Название (рус.)</th>
                        <th className="px-4 py-4">Срок годности</th>
                        <th className="px-4 py-4">Кол-во</th>
                        <th className="px-4 py-4">Кол-во в штуках</th>
                        <th className="px-4 py-4">Цена за штуку</th>
                        <th className="px-4 py-4">Сумма</th>
                        <th className="px-6 py-4 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {items.map((item, idx) => (
                        <tr key={item.lineId} className="bg-white/50">
                          <td className="px-4 py-4 text-xs font-bold text-[#5A5A40]/70">{idx + 1}</td>
                          <td className="px-4 py-4 min-w-56">
                            <input type="text" value={item.name} onChange={(e) => updateItem(item.lineId, 'name', e.target.value)} className="w-full bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs font-bold" />
                            {item.confidence && <p className="text-[10px] mt-1 font-bold uppercase tracking-widest text-[#5A5A40]/60">{item.confidence}</p>}
                            {item.warnings && <p className="text-[10px] text-red-500 mt-1">{item.warnings}</p>}
                          </td>
                          <td className="px-4 py-4"><input type="date" value={item.expiryDate} onChange={(e) => updateItem(item.lineId, 'expiryDate', e.target.value)} className="w-32 bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs" /></td>
                          <td className="px-4 py-4"><input type="number" min="0" value={item.quantity} onChange={(e) => updateItem(item.lineId, 'quantity', parseInt(e.target.value) || 0)} className="w-16 bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs" /></td>
                          <td className="px-4 py-4"><input type="number" min="1" value={item.unitsInPack} onChange={(e) => updateItem(item.lineId, 'unitsInPack', Math.max(1, parseInt(e.target.value) || 1))} className="w-20 bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs" /></td>
                          <td className="px-4 py-4"><input type="number" step="0.01" min="0" value={item.costPrice} onChange={(e) => updateItem(item.lineId, 'costPrice', parseFloat(e.target.value) || 0)} className="w-24 bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs" /></td>
                          <td className="px-4 py-4"><span className="text-xs font-bold text-[#5A5A40]">{(item.quantity * item.unitsInPack * item.costPrice).toFixed(2)} TJS</span></td>
                          <td className="px-6 py-4 text-right">
                            <button type="button" onClick={() => removeItem(item.lineId)} className="p-1.5 text-[#5A5A40]/30 hover:text-red-500">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-6 py-12 text-center text-[#5A5A40]/30 italic text-sm">Позиции в накладную еще не добавлены.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </form>

            <div className="p-8 bg-[#f5f5f0]/30 border-t border-[#5A5A40]/5 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-8">
                <div>
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest">Всего позиций</p>
                  <p className="text-xl font-bold text-[#5A5A40]">{items.length}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest">Сумма до скидки</p>
                  <p className="text-xl font-bold text-[#5A5A40]">{grossTotal.toFixed(2)} TJS</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest">Скидка</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-24 bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs font-bold text-[#5A5A40]"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest">Итог с учетом скидки</p>
                  <p className="text-xl font-bold text-[#5A5A40]">{netTotal.toFixed(2)} TJS</p>
                </div>
              </div>

              <div className="flex items-center gap-4 w-full md:w-auto">
                {error && (
                  <div className="flex items-center gap-2 text-red-600 text-xs font-medium">
                    <AlertCircle size={14} />
                    {error}
                  </div>
                )}
                {!error && !success && !processing && submitBlockers.length > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 text-xs font-medium">
                    <AlertCircle size={14} />
                    Для записи в БД: {submitBlockers.join(', ')}.
                  </div>
                )}
                {success && (
                  <div className="flex items-center gap-2 text-emerald-600 text-xs font-medium">
                    <CheckCircle2 size={14} />
                    Накладная успешно импортирована
                  </div>
                )}
                <button type="button" onClick={onClose} className="px-8 py-3 bg-white text-[#5A5A40] rounded-2xl font-bold border border-[#5A5A40]/10 hover:bg-white/80">Отмена</button>
                <button onClick={handleSubmit} disabled={submitBlockers.length > 0 || processing} className="px-12 py-3 bg-[#5A5A40] text-white rounded-2xl font-bold shadow-xl hover:bg-[#4A4A30] disabled:opacity-50">
                  {processing ? 'Обработка...' : 'Завершить импорт'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
