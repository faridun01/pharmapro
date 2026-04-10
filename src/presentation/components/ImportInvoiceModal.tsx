import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Trash2, FileText, Truck, Calendar, CheckCircle2, AlertCircle, Search, Pill, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePharmacy } from '../context';
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

type ImportFileKind = 'image' | 'pdf' | 'excel' | 'unsupported';

const randomBatch = () => `B-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

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
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [usedEngine, setUsedEngine] = useState<string | null>(null);
  const [ocrDraftId, setOcrDraftId] = useState<string | null>(null);
  const [reviewSummary, setReviewSummary] = useState<{ total: number; high: number; medium: number; low: number; needsReview: number } | null>(null);
  const [rawOcrText, setRawOcrText] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);
  const [ocrJsonResponse, setOcrJsonResponse] = useState<OcrAnalyzeResponse | null>(null);
  const [showOcrJson, setShowOcrJson] = useState(false);
  const [pendingOcrItems, setPendingOcrItems] = useState<InvoiceImportItem[] | null>(null);
  const [jsonCopied, setJsonCopied] = useState(false);
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

  const addEmptyItem = () => {
    setItems((prev) => [
      ...prev,
      {
        lineId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productId: null,
        name: '',
        sku: '',
        barcode: '',
        quantity: 1,
        unitsInPack: 1,
        costPrice: 0,
        batchNumber: randomBatch(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    ]);
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

  const findSupplierByName = (candidate: string) => {
    const normalizedCandidate = String(candidate || '').trim().toLowerCase();
    if (!normalizedCandidate) return null;

    return suppliers.find(
      (supplier) =>
        supplier.name.toLowerCase().includes(normalizedCandidate) ||
        normalizedCandidate.includes(supplier.name.toLowerCase()),
    ) || null;
  };

  const applyStructuredPreview = (data: OcrAnalyzeResponse) => {
    setUsedEngine(data.engine ?? null);
    setReviewSummary(data.review ?? null);
    if (data.rawText) setRawOcrText(data.rawText);

    if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    if (data.invoiceDate) setDate(data.invoiceDate);

    if (data.supplierName) {
      const foundSupplier = findSupplierByName(data.supplierName);
      if (foundSupplier) setSupplierId(foundSupplier.id);
    }

    return (data.items || []).map((item: any, index: number) => ({
      lineId: item.lineId || `parsed-${Date.now()}-${index}`,
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
    })) as InvoiceImportItem[];
  };

  const requestStructuredPreview = async (file: File) => {
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

  const detectImportFileKind = (file: File): ImportFileKind => {
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

  const processUploadedFile = async (file: File) => {
    const fileKind = detectImportFileKind(file);
    if (fileKind === 'unsupported') {
      throw new Error('Поддерживаются только изображения, PDF, XLSX и XLS файлы');
    }

    setAnalyzing(true);
    setError(null);
    setSelectedImportFile(file);
    setRawOcrText(null);
    setShowRawText(false);
    setOcrJsonResponse(null);
    setShowOcrJson(fileKind !== 'excel');
    setPendingOcrItems(null);
    setJsonCopied(false);
    setOcrDraftId(null);
    setExcelPreviewItems(null);

    try {
      if (fileKind === 'excel') {
        const data = await requestStructuredPreview(file);
        const nextItems = applyStructuredPreview(data);
        if (!nextItems.length) {
          throw new Error(data.warning || 'В Excel не найдено валидных строк для импорта');
        }
        setExcelPreviewItems(nextItems);
        return;
      }

      const data: OcrAnalyzeResponse = fileKind === 'pdf'
        ? await requestStructuredPreview(file)
        : await (async () => {
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
            throw new Error(body.error || t('Failed to analyze invoice'));
          }

          return await response.json() as OcrAnalyzeResponse;
        })();

      setOcrJsonResponse(data);
      const parsedItems = applyStructuredPreview(data);

      if (parsedItems.length === 0) {
        throw new Error(data.warning || t('No invoice items recognized'));
      }

      setPendingOcrItems(parsedItems);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    try {
      await processUploadedFile(file);
    } catch (err: any) {
      setError(err.message || 'Не удалось обработать файл');
    } finally {
      event.target.value = '';
    }
  };

  const handleAnalyzeExcel = async () => {
    if (!selectedImportFile || detectImportFileKind(selectedImportFile) !== 'excel') {
      setError('Сначала выберите Excel-файл');
      return;
    }

    try {
      await processUploadedFile(selectedImportFile);
    } catch (e: any) {
      setError(e?.message || 'Не удалось обработать Excel-файл');
    }
  };

  const confirmExcelPreview = () => {
    if (!excelPreviewItems?.length) return;
    const existing = new Set(items.map((i) => buildItemIdentity(i)));
    const unique = excelPreviewItems.filter((i) => !existing.has(buildItemIdentity(i)));
    setItems((prev) => [...prev, ...unique]);
    setExcelPreviewItems(null);
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
    if (!selectedImportFile) {
      setError(t('Select invoice image first'));
      return;
    }

    try {
      await processUploadedFile(selectedImportFile);
    } catch (err: any) {
      setError(err.message || t('Failed to analyze invoice'));
    }
  };

  const resetFormAndClose = () => {
    setSuccess(false);
    onClose();
    setItems([]);
    setSupplierId('');
    setInvoiceNumber('');
    setSelectedImportFile(null);
    setOcrDraftId(null);
    setReviewSummary(null);
    setRawOcrText(null);
    setShowRawText(false);
    setOcrJsonResponse(null);
    setShowOcrJson(false);
    setPendingOcrItems(null);
    setJsonCopied(false);
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
      const importResolvedProducts = new Map<string, string>();

      const normalizeImportKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

      for (const item of items) {
        let productId = item.productId;
        const normalizedSku = item.sku?.trim();
        const skuKey = normalizedSku ? `sku:${normalizedSku.toLowerCase()}` : '';
        const nameKey = `name:${normalizeImportKey(item.name)}`;

        if (!productId) {
          productId = (skuKey && importResolvedProducts.get(skuKey)) || importResolvedProducts.get(nameKey) || '';
        }

        if (!productId) {
          const createdProduct = await createProduct({
            id: '',
            name: item.name,
            sku: normalizedSku || createSku(item.name),
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

        if (productId) {
          if (skuKey) {
            importResolvedProducts.set(skuKey, productId);
          }
          importResolvedProducts.set(nameKey, productId);
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
                  <label className="inline-flex cursor-pointer items-center gap-2 px-4 py-2 bg-[#151619] text-white text-xs font-bold uppercase tracking-widest rounded-xl">
                    <Sparkles size={14} />
                    {analyzing ? 'Обработка...' : 'Выбрать файл'}
                    <input type="file" accept="image/*,application/pdf,.xlsx,.xls" onChange={handleImportFileChange} className="hidden" />
                  </label>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    {usedEngine && <span className="px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-emerald-100 text-emerald-700">{usedEngine === 'ollama' ? 'OLLAMA' : usedEngine === 'pdf+ollama' ? 'PDF + OLLAMA' : usedEngine}</span>}
                    {selectedImportFile && <p className="text-xs text-[#5A5A40]/70 truncate max-w-56">{selectedImportFile.name}</p>}
                  </div>
                  <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest md:basis-full">
                    Загрузите файл накладной.
                  </p>
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
                    <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Укажите номер накладной" required className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 text-sm outline-none" />
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
                  <div>
                    <h4 className="text-sm font-bold text-[#5A5A40] uppercase tracking-widest">Позиции накладной</h4>
                    <p className="text-xs text-[#5A5A40]/55 mt-1">Для прихода достаточно указать название, срок годности, количество и цену за единицу.</p>
                  </div>
                  {reviewSummary && (
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                      <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700">H: {reviewSummary.high}</span>
                      <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700">M: {reviewSummary.medium}</span>
                      <span className="px-2 py-1 rounded-lg bg-red-100 text-red-700">L: {reviewSummary.low}</span>
                      <span className="px-2 py-1 rounded-lg bg-[#151619] text-white">Review: {reviewSummary.needsReview}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={addEmptyItem}
                      className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-xs font-bold hover:bg-[#4A4A30]"
                    >
                      Добавить строку
                    </button>
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={14} />
                      <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Найти товар из каталога..." className="w-full pl-9 pr-4 py-2 bg-[#f5f5f0]/50 border-none rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#5A5A40]/20" />
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
                </div>

                <div className="bg-[#f5f5f0]/30 rounded-3xl border border-[#5A5A40]/5 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#f5f5f0]/50 text-[10px] uppercase tracking-widest text-[#5A5A40]/50 font-bold">
                        <th className="px-4 py-4">№ ({items.length})</th>
                        <th className="px-4 py-4">Название (рус.)</th>
                        <th className="px-4 py-4">Срок годности</th>
                        <th className="px-4 py-4">Кол-во</th>
                        <th className="px-4 py-4">Цена за ед.</th>
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
                          <td className="px-4 py-4"><input type="number" step="0.01" min="0" value={item.costPrice} onChange={(e) => updateItem(item.lineId, 'costPrice', parseFloat(e.target.value) || 0)} className="w-24 bg-white border border-[#5A5A40]/10 rounded-lg px-2 py-1 text-xs" /></td>
                          <td className="px-4 py-4"><span className="text-xs font-bold text-[#5A5A40]">{(item.quantity * item.costPrice).toFixed(2)} TJS</span></td>
                          <td className="px-6 py-4 text-right">
                            <button type="button" onClick={() => removeItem(item.lineId)} className="p-1.5 text-[#5A5A40]/30 hover:text-red-500">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-[#5A5A40]/30 italic text-sm">Позиции в накладную еще не добавлены.</td>
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
