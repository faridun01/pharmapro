import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';
import { saveLatestClosedShiftNotice } from '../../lib/shiftCloseNotice';
import { CloseShiftModal, OpenShiftModal } from './ShiftView';
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { Product } from '../../core/domain';

type CartItem = Product & {
  quantity: number;
  batchId?: string;
  batchNumber?: string;
  discountAmount?: number;
  prescriptionPresented?: boolean;
  expiryDate?: string;
};

type ActiveShift = {
  id: string;
  shiftNo: string;
  status: 'OPEN' | 'CLOSED';
  openAt: string;
};

type ClosedShiftSummary = {
  shiftId: string;
  shiftNo?: string;
  grossProfit: number;
  finalAmount: number;
  netSales: number;
};

const formatUnitQuantity = (quantity: number) => {
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  return `${safeQuantity} ед.`;
};

const ProductCatalog = memo(({
  filteredProducts,
  onAddToCart,
}: {
  filteredProducts: Product[];
  onAddToCart: (product: Product) => void;
}) => {
  if (filteredProducts.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar [direction:rtl]">
        <div className="space-y-2 [direction:ltr]">
          <div className="rounded-2xl border border-dashed border-[#5A5A40]/15 bg-[#f5f5f0]/40 px-5 py-8 text-center text-sm text-[#5A5A40]/55">
            Нет доступных товаров по текущему запросу.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar [direction:rtl]">
      <div className="space-y-2 [direction:ltr]">
        {filteredProducts.map((product, index) => {
          const stockLabel = formatUnitQuantity(product.totalStock);
          const lowStock = product.totalStock < (product.minStock || 10);
          const metaBadges = [product.countryOfOrigin].filter(Boolean);

          return (
            <button
              key={product.id}
              onClick={() => onAddToCart(product)}
              className="w-full bg-white px-4 py-3 rounded-2xl shadow-sm border border-[#5A5A40]/5 hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-[#f5f5f0] rounded-xl flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors shrink-0">
                  <span className="text-xs font-bold">{index + 1}</span>
                </div>
                <div className="min-w-0 flex-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-[#5A5A40] truncate">{product.name}</h3>
                    <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest mt-0.5">{product.sku}</p>
                    {metaBadges.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {product.countryOfOrigin && (
                          <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                            {product.countryOfOrigin}
                          </span>
                        )}
                      </div>
                    )}
                    <p className={`text-[10px] font-bold mt-1.5 px-2 py-1 rounded-lg w-fit ${lowStock ? 'bg-amber-100 text-amber-700' : 'bg-[#f5f5f0] text-[#5A5A40]/60'}`}>
                      Остаток: {stockLabel}
                    </p>
                  </div>
                  <p className="text-[16px] font-bold text-[#5A5A40] leading-none text-right tabular-nums min-w-24">
                    {product.sellingPrice.toFixed(2)} TJS
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

ProductCatalog.displayName = 'ProductCatalog';

const BatchSelectorModal = ({ 
  product, 
  onSelect, 
  onClose 
}: { 
  product: Product & { batches: any[] }, 
  onSelect: (batch: any) => void, 
  onClose: () => void 
}) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
        <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#5A5A40]">{product.name}</h3>
            <p className="text-sm text-[#5A5A40]/60">Выберите конкретную партию для продажи</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#f5f5f0] rounded-xl transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          <div className="grid gap-3">
            {[...product.batches]
              .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())
              .map((batch) => {
              const isExpired = new Date(batch.expiryDate) < new Date();
              return (
                <button
                  key={batch.id}
                  disabled={isExpired || batch.quantity <= 0}
                  onClick={() => onSelect(batch)}
                  className={`flex items-center justify-between p-4 rounded-2xl border text-left transition-all ${
                    isExpired ? 'bg-red-50/50 border-red-100 opacity-60 cursor-not-allowed' : 'bg-white border-[#5A5A40]/10 hover:border-[#5A5A40] hover:shadow-md'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#5A5A40]">{batch.batchNumber}</span>
                      {isExpired && <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Истек</span>}
                    </div>
                    <p className="text-xs text-[#5A5A40]/60 mt-1">Годен до: {new Date(batch.expiryDate).toLocaleDateString()}</p>
                    <p className="text-xs text-[#5A5A40]/60">Поставщик: {(batch as any).supplier?.name || (batch as any).supplierName || '—'}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="font-bold text-[#5A5A40]">{batch.quantity} ед.</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};


export const POSView: React.FC = () => {
  const { products, refreshProducts, processTransaction, user } = usePharmacy();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [paymentType, setPaymentType] = useState<'CASH' | 'CARD'>('CASH');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [isOpenShiftModal, setIsOpenShiftModal] = useState(false);
  const [isCloseShiftModal, setIsCloseShiftModal] = useState(false);
  const [isRecentSalesModal, setIsRecentSalesModal] = useState(false);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ClosedShiftSummary | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [barcodeScanning, setBarcodeScanning] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState<{ productId: string, cartItemKey: string } | null>(null);
  const [overallDiscountPercent, setOverallDiscountPercent] = useState<number>(0);

  const normalizedSearchTerm = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const cartProductIds = useMemo(() => new Set(cart.map((item) => item.id)), [cart]);
  const filteredProducts = useMemo(() => products.filter((product) => {
    if (product.totalStock <= 0) return false;
    if (cartProductIds.has(product.id)) return false;
    return (
      product.name.toLowerCase().includes(normalizedSearchTerm) ||
      product.sku.toLowerCase().includes(normalizedSearchTerm) ||
      String(product.barcode || '').toLowerCase().includes(normalizedSearchTerm) ||
      String(product.manufacturer || '').toLowerCase().includes(normalizedSearchTerm) ||
      String(product.countryOfOrigin || '').toLowerCase().includes(normalizedSearchTerm)
    );
  }), [products, normalizedSearchTerm, cartProductIds]);

  const getCartItemKey = useCallback((item: Pick<CartItem, 'id' | 'batchId'>) => `${item.id}:${item.batchId || 'default'}`, []);
  const findProductByScannedCode = useCallback((rawCode: string) => {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedCode = normalize(rawCode);
    if (!normalizedCode) return null;
    return (
      products.find((product) => normalize(product.sku) === normalizedCode) ||
      products.find((product) => normalize(product.barcode || '') === normalizedCode) ||
      products.find((product) => normalize(product.id) === normalizedCode) ||
      null
    );
  }, [products]);

  const addToCart = useCallback((product: Product, batch?: any) => {
    if (product.totalStock <= 0) {
      setError('Товар закончился на складе');
      window.setTimeout(() => setError(null), 2000);
      return;
    }

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.id === product.id && (!batch || item.batchId === batch.id));
      if (existing) {
        return currentCart.map((item) => {
          if (getCartItemKey(item) !== getCartItemKey({ id: product.id, batchId: batch?.id })) return item;
          return { ...item, quantity: Math.min(batch ? batch.quantity : item.totalStock, item.quantity + 1) };
        });
      }
      return [
        ...currentCart,
        {
          ...product,
          quantity: 1,
          batchId: batch?.id,
          batchNumber: batch?.batchNumber,
          expiryDate: batch?.expiryDate,
          prescriptionPresented: !product.prescription, // Default to true if not required
        }
      ];
    });
  }, [getCartItemKey]);

  const subtotal = useMemo(() => cart.reduce((acc, item) => acc + (item.sellingPrice * item.quantity), 0), [cart]);
  const total = subtotal;

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  const loadActiveShift = useCallback(async () => {
    setShiftLoading(true);
    setShiftError(null);
    try {
      const response = await fetch('/api/shifts/active', { headers: await buildApiHeaders() });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось проверить активную смену');
      }
      setActiveShift(body);
    } catch (shiftLoadError: any) {
      setActiveShift(null);
      setShiftError(shiftLoadError?.message || 'Не удалось проверить активную смену');
    } finally {
      setShiftLoading(false);
    }
  }, []);

  const loadRecentSales = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/invoices?limit=10', { headers: await buildApiHeaders() });
      const data = await res.json();
      setRecentSales(data.items || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void loadActiveShift();
    void loadRecentSales();
    const handleFocus = () => {
      void loadActiveShift();
      void loadRecentSales();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadActiveShift, loadRecentSales]);

  useEffect(() => {
    if (products.length > 0) return;
    void refreshProducts();
  }, [products.length, refreshProducts]);

  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();
    const handleKeyDown = (event: KeyboardEvent) => {
      const currentTime = Date.now();
      if (currentTime - lastKeyTime > 50) {
        buffer = '';
      }
      if (event.key === 'Enter') {
        if (buffer.length > 5) {
          const product = findProductByScannedCode(buffer);
          if (product) {
            addToCart(product);
          }
          buffer = '';
        }
      } else if (event.key.length === 1) {
        buffer += event.key;
      }
      lastKeyTime = currentTime;
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addToCart, findProductByScannedCode]);

  const handleBarcodeScan = useCallback(async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const code = barcodeInput.trim();
    if (!code) return;

    // 1. Fast path: look in already-loaded products list
    const local = findProductByScannedCode(code);
    if (local) {
      addToCart(local);
      setBarcodeInput('');
      barcodeInputRef.current?.focus();
      return;
    }

    // 2. Slow path: ask the server (handles large catalogs)
    setBarcodeScanning(true);
    setBarcodeInput('');
    try {
      const res = await fetch(
        `/api/products/barcode/${encodeURIComponent(code)}`,
        { headers: await buildApiHeaders(false) },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Товар «${code}» не найден`);
        window.setTimeout(() => setError(null), 3000);
      } else {
        // Product found via API — add to cart (it may not be in local list yet)
        addToCart(body as Product);
        // Refresh the local list so next scan is fast
        void refreshProducts();
      }
    } catch {
      setError(`Ошибка при поиске товара по штрихкоду`);
      window.setTimeout(() => setError(null), 3000);
    } finally {
      setBarcodeScanning(false);
      barcodeInputRef.current?.focus();
    }
  }, [addToCart, barcodeInput, findProductByScannedCode, refreshProducts]);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const firstProduct = filteredProducts[0];
    if (firstProduct) {
      addToCart(firstProduct);
    }
  }, [addToCart, filteredProducts]);

  const removeFromCart = useCallback((cartItemKey: string) => {
    setCart((currentCart) => currentCart.filter((item) => getCartItemKey(item) !== cartItemKey));
  }, [getCartItemKey]);

  const updateQuantity = useCallback((cartItemKey: string, delta: number) => {
    setCart((currentCart) => currentCart.map((item) => {
      if (getCartItemKey(item) !== cartItemKey) return item;
      return { ...item, quantity: Math.max(1, Math.min(item.totalStock, item.quantity + delta)) };
    }));
  }, [getCartItemKey]);

  const updateQuantityFromInput = useCallback((cartItemKey: string, unitsValue: string) => {
    setCart((currentCart) => currentCart.map((item) => {
      if (getCartItemKey(item) !== cartItemKey) return item;
      const parsedUnits = Number(unitsValue);
      if (!Number.isFinite(parsedUnits)) return item;
      return { ...item, quantity: Math.max(1, Math.min(item.totalStock, Math.floor(parsedUnits))) };
    }));
  }, [getCartItemKey]);


  const togglePrescription = (cartItemKey: string) => {
    setCart(curr => curr.map(item => getCartItemKey(item) === cartItemKey ? { ...item, prescriptionPresented: !item.prescriptionPresented } : item));
  };

  const handlePrintReceipt = (invoice: any) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const receiptHtml = `
      <html>
        <head>
          <title>Чек - ${invoice.invoiceNo}</title>
          <style>
            body { 
              background: #6b7280; 
              display: flex; 
              justify-content: center; 
              align-items: flex-start; 
              margin: 0; 
              padding: 40px 0;
              font-family: 'Courier New', Courier, monospace;
            }
            .paper { 
              background: #fff; 
              width: 80mm; 
              padding: 5mm; 
              box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
            }
            .h { text-align: center; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; }
            .sep { border-bottom: 1px dashed #000; margin: 5px 0; }
            .item { display: flex; justify-content: space-between; margin-bottom: 2px; }
            .total { font-weight: bold; font-size: 14px; display: flex; justify-content: space-between; margin-top: 5px; }
            .footer { text-align: center; font-size: 10px; margin-top: 15px; }
            @media print {
              body { background: none; padding: 0; display: block; }
              .paper { box-shadow: none; width: 100%; border: none; }
              .print-btn { display: none; }
            }
            .print-btn {
              position: fixed;
              top: 20px;
              right: 20px;
              padding: 10px 20px;
              background: #5A5A40;
              color: white;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              font-family: sans-serif;
              font-weight: bold;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
          </style>
        </head>
        <body>
          <button class="print-btn" onclick="window.print()">ПЕЧАТАТЬ</button>
          <div class="paper">
            <div class="h">АПТЕКА PHARMAPRO</div>
            <div class="h">ТОВАРНЫЙ ЧЕК</div>
            <div>№: ${invoice.invoiceNo}</div>
            <div>Дата: ${new Date(invoice.createdAt).toLocaleString()}</div>
            <div>Кассир: ${user?.name || 'Система'}</div>
            <div class="sep"></div>
            ${invoice.items.map((it: any) => `
              <div class="item">
                <span>${it.productName} x${it.quantity}</span>
                <span>${it.totalPrice.toFixed(2)}</span>
              </div>
            `).join('')}
            <div class="sep"></div>
            <div class="item"><span>Итого:</span><span>${invoice.totalAmount.toFixed(2)}</span></div>
            ${invoice.discount > 0 ? `<div class="item"><span>Скидка:</span><span>-${invoice.discount.toFixed(2)}</span></div>` : ''}
            <div class="total"><span>К ОПЛАТЕ:</span><span>${invoice.totalAmount.toFixed(2)}</span></div>
            <div class="sep"></div>
            <div>Тип оплаты: ${invoice.paymentType}</div>
            <div class="footer">Спасибо за покупку!<br>Желаем здоровья!</div>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  };

  const handleVoidSale = async (id: string) => {
    if (!window.confirm('Вы уверены, что хотите отменить этот чек? Товары вернутся на склад.')) return;
    try {
      setProcessing(true);
      const res = await fetch(`/api/sales/void/${id}`, { method: 'POST', headers: await buildApiHeaders() });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ошибка при отмене');
      }
      setSuccess(true);
      void loadActiveShift();
      void loadRecentSales();
      void refreshProducts();
      window.setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handlePrintZReport = async () => {
    if (!activeShift) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    try {
      const res = await fetch(`/api/reports/shift/${activeShift.id}`, { headers: await buildApiHeaders() });
      const data = await res.json();

      const html = `
        <html>
          <head>
            <title>Z-Отчет - ${activeShift.shiftNo}</title>
            <style>
              body { 
                background: #6b7280; 
                display: flex; 
                justify-content: center; 
                align-items: flex-start; 
                margin: 0; 
                padding: 40px 0;
                font-family: monospace;
              }
              .paper { 
                background: #fff; 
                width: 80mm; 
                padding: 5mm; 
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
              }
              @media print {
                body { background: none; padding: 0; display: block; }
                .paper { box-shadow: none; width: 100%; border: none; }
                .print-btn { display: none; }
              }
              .print-btn {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 10px 20px;
                background: #5A5A40;
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-family: sans-serif;
                font-weight: bold;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              }
            </style>
          </head>
          <body>
            <button class="print-btn" onclick="window.print()">ПЕЧАТАТЬ</button>
            <div class="paper">
              <h2 style="text-align:center">Z-ОТЧЕТ</h2>
              <div>Смена: ${activeShift.shiftNo}</div>
              <div>Открыта: ${new Date(activeShift.openAt).toLocaleString()}</div>
              <div>Кассир: ${user?.name}</div>
              <hr/>
              <div style="display:flex; justify-content:space-between"><span>ПРОДАЖИ (ИТОГО):</span> <span>${data.totalSales?.toFixed(2) || '0.00'}</span></div>
              <div style="display:flex; justify-content:space-between"><span>НАЛИЧНЫЕ:</span> <span>${data.cashSales?.toFixed(2) || '0.00'}</span></div>
              <div style="display:flex; justify-content:space-between"><span>КАРТА:</span> <span>${data.cardSales?.toFixed(2) || '0.00'}</span></div>
              <hr/>
              <div style="text-align:center">PHARMAPRO POS</div>
            </div>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err) {
      printWindow.close();
      setError('Ошибка при формировании Z-отчета');
    }
  };

  const handleComplete = async () => {
    if (cart.length === 0) return;
    
    const missingPrescription = cart.find(it => it.prescription && !it.prescriptionPresented);
    if (missingPrescription) {
      setError(`Для товара "${missingPrescription.name}" требуется рецепт`);
      return;
    }

    if (!activeShift) {
      setError('Сначала откройте смену, затем оформляйте продажу');
      return;
    }


    setProcessing(true);
    setError(null);
    try {
      const res = await processTransaction({
        items: cart.map((item) => ({ 
          productId: item.id, 
          batchId: item.batchId,
          quantity: item.quantity, 
          sellingPrice: item.sellingPrice,
          prescriptionPresented: item.prescriptionPresented,
        })),
        discountAmount: 0,
        taxAmount: 0,
        total,
        paymentType,
        paidAmount: total,
        userId: user?.id || '',
        date: new Date(),
      });
      
      setSuccess(true);
      if (res && (res as any).id) handlePrintReceipt(res);
      setCart([]);
      void loadActiveShift();
      window.setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Не удалось завершить продажу');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <div className="grid w-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(360px,32vw)] gap-4 h-[calc(100vh-12rem)] animate-in fade-in duration-500">
        <div className="bg-white rounded-3xl shadow-xl border border-[#5A5A40]/5 flex flex-col overflow-hidden min-w-0 h-full">
          <div className="p-5 border-b border-[#5A5A40]/5 flex flex-col gap-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  Система онлайн
                </div>
                <button type="button" onClick={() => void loadActiveShift()} className="w-9 h-9 rounded-xl border border-[#5A5A40]/10 bg-white flex items-center justify-center text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors" title="Обновить статус смены">
                  <RefreshCw size={15} className={shiftLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 ${activeShift ? 'border-emerald-100 bg-emerald-50/80 text-emerald-700' : 'border-amber-100 bg-amber-50/80 text-amber-700'}`}>
              <div className="flex items-center gap-3 min-w-0">
                {activeShift ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest">{activeShift ? 'Смена открыта' : 'Смена не открыта'}</p>
                  <p className="text-xs mt-1 truncate">
                    {activeShift ? `${activeShift.shiftNo} • открыта ${new Date(activeShift.openAt).toLocaleString()}` : (shiftError || 'Для оформления продажи сначала откройте смену в разделе смен.')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setIsRecentSalesModal(true)} className="px-3 py-2 rounded-xl border border-[#5A5A40]/10 bg-white text-[#5A5A40] text-xs font-semibold hover:bg-[#f5f5f0] transition-colors">История</button>
                {activeShift ? (
                  <>
                    <button type="button" onClick={handlePrintZReport} className="px-3 py-2 rounded-xl border border-[#5A5A40]/10 bg-white text-[#5A5A40] text-xs font-semibold hover:bg-[#f5f5f0] transition-colors">Z-Отчет</button>
                    <button type="button" onClick={() => setIsCloseShiftModal(true)} className="px-3 py-2 rounded-xl bg-[#5A5A40] text-white text-xs font-semibold hover:bg-[#4A4A30] transition-colors">Закрыть смену</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setIsOpenShiftModal(true)} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors">Открыть смену</button>
                )}
              </div>
            </div>

            {closedShiftSummary && !activeShift && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Последняя закрытая смена</p>
                  <p className="text-sm text-emerald-800 mt-1">{closedShiftSummary.shiftNo || 'Смена'} завершена. Прибыль за сегодня уже рассчитана.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-white px-3 py-1.5 text-emerald-800">Прибыль: {closedShiftSummary.grossProfit.toFixed(2)} TJS</span>
                  <span className="rounded-full bg-white px-3 py-1.5 text-[#5A5A40]">Продажи нетто: {closedShiftSummary.netSales.toFixed(2)} TJS</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 group-focus-within:text-[#5A5A40] transition-colors" size={18} />
                <input ref={searchInputRef} type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Поиск товара по названию" className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 transition-all text-sm outline-none" />
              </div>
              <div className="relative group">
                <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 group-focus-within:text-[#5A5A40] transition-colors" size={18} />
                <input
                  ref={barcodeInputRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  onKeyDown={(e) => void handleBarcodeScan(e)}
                  placeholder={barcodeScanning ? 'Поиск...' : 'Сканируйте штрихкод'}
                  disabled={barcodeScanning}
                  className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 transition-all text-sm outline-none disabled:opacity-60"
                />
                {barcodeScanning && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <RefreshCw size={14} className="animate-spin text-[#5A5A40]/50" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[#5A5A40]/55">Найдено: {filteredProducts.length}</span>
                <span className="text-[11px] text-[#5A5A40]/40"></span>
              </div>
            </div>
          </div>

          <ProductCatalog 
            filteredProducts={filteredProducts} 
            onAddToCart={(p) => {
              if (p.batches && p.batches.length > 1) {
                setShowBatchModal({ productId: p.id, cartItemKey: '' } as any);
              } else {
                addToCart(p, p.batches?.[0]);
              }
            }} 
          />
        </div>

        <div className="bg-white rounded-3xl shadow-xl border border-[#5A5A40]/5 flex flex-col overflow-hidden min-w-0">
          <div className="p-3 border-b border-[#5A5A40]/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart size={17} className="text-[#5A5A40]" />
              <h3 className="text-[15px] font-bold text-[#5A5A40]">Текущий заказ</h3>
            </div>
            <span className="bg-[#f5f5f0] text-[#5A5A40] text-[11px] font-bold px-2 py-1 rounded-lg">{cart.length} позиций</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
            {cart.length > 0 ? (
              cart.map((item) => {
                const cartItemKey = getCartItemKey(item);
                const metaBadges = [item.countryOfOrigin].filter(Boolean);
                return (
                  <div key={cartItemKey} className="p-2 bg-[#f5f5f0]/50 rounded-xl border border-[#5A5A40]/5 group space-y-1.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[12px] font-bold text-[#5A5A40] truncate leading-tight">{item.name}</h4>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.batchNumber && <span className="bg-[#5A5A40]/10 text-[#5A5A40] text-[9px] px-1.5 py-0.5 rounded-full font-bold">Партия: {item.batchNumber}</span>}
                          {item.expiryDate && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${new Date(item.expiryDate) < new Date(new Date().getTime() + 30*24*60*60*1000) ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                              До: {new Date(item.expiryDate).toLocaleDateString()}
                            </span>
                          )}
                          {item.prescription && (
                             <button 
                               onClick={() => togglePrescription(cartItemKey)}
                               className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border transition-colors ${item.prescriptionPresented ? 'bg-emerald-100 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}
                             >
                               {item.prescriptionPresented ? 'Рецепт принят' : 'Нужен рецепт!'}
                             </button>
                          )}
                        </div>
                        <p className="text-[10px] text-[#5A5A40]/55 mt-1 leading-tight">{item.sellingPrice.toFixed(2)} TJS / ед. • Склад: {formatUnitQuantity(item.totalStock)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <p className="text-[12px] font-bold text-[#5A5A40] tabular-nums min-w-22 text-right">{(item.sellingPrice * item.quantity).toFixed(2)} TJS</p>
                        <button onClick={() => removeFromCart(cartItemKey)} className="p-1 text-[#5A5A40]/35 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => updateQuantity(cartItemKey, -1)} className="w-5 h-5 bg-white rounded-md flex items-center justify-center text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white transition-colors shadow-sm">
                        <Minus size={11} />
                      </button>
                      <span className="text-[11px] font-bold text-[#5A5A40] min-w-14 text-center tabular-nums">{formatUnitQuantity(item.quantity)}</span>
                      <button onClick={() => updateQuantity(cartItemKey, 1)} className="w-5 h-5 bg-white rounded-md flex items-center justify-center text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white transition-colors shadow-sm">
                        <Plus size={11} />
                      </button>
                      <input type="number" min={1} step={1} value={item.quantity} onChange={(event) => updateQuantityFromInput(cartItemKey, event.target.value)} className="w-20 px-2 py-1 bg-white border border-[#5A5A40]/10 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#5A5A40]/15 tabular-nums" placeholder="ед." aria-label="Единицы" />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[#5A5A40]/30 text-center p-6">
                <ShoppingCart size={38} strokeWidth={1.1} className="mb-3" />
                <p className="text-[13px] font-medium italic">Корзина пуста.<br />Выберите товары для начала.</p>
              </div>
            )}
          </div>

          <div className="p-3 bg-[#f5f5f0]/50 border-t border-[#5A5A40]/5 space-y-2.5 shrink-0">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm font-medium text-[#5A5A40]/60">
                <span>Промежуточный итог</span>
                <span className="tabular-nums">{subtotal.toFixed(2)} TJS</span>
              </div>
              <div className="flex justify-between text-[18px] font-bold text-[#5A5A40] pt-2 border-t border-[#5A5A40]/10">
                <span>Итого</span>
                <span className="tabular-nums min-w-30 text-right">{total.toFixed(2)} TJS</span>
              </div>
            </div>


            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPaymentType('CASH')} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CASH' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}>
                <Wallet size={14} />
                Наличные
              </button>
              <button onClick={() => setPaymentType('CARD')} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CARD' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}>
                <CreditCard size={14} />
                Карта
              </button>
            </div>


            {error && <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 flex items-center gap-2"><AlertCircle size={14} />{error}</div>}
            {success && <div className="p-3 bg-emerald-50 text-emerald-600 text-xs rounded-lg border border-emerald-100 flex items-center gap-2"><CheckCircle2 size={14} />Продажа успешно завершена</div>}

            <button onClick={handleComplete} disabled={cart.length === 0 || processing || !activeShift || shiftLoading} className="w-full bg-[#5A5A40] text-white py-2.5 rounded-2xl font-bold shadow-xl hover:bg-[#4A4A30] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100">
              {processing ? 'Обработка...' : !activeShift ? 'Сначала откройте смену' : 'Завершить продажу'}
            </button>
          </div>
        </div>
      </div>

      <OpenShiftModal
        open={isOpenShiftModal}
        onClose={() => setIsOpenShiftModal(false)}
        onOpened={() => {
          setClosedShiftSummary(null);
          void loadActiveShift();
        }}
      />
      {activeShift && (
        <CloseShiftModal
          shiftId={activeShift.id}
          open={isCloseShiftModal}
          onClose={() => setIsCloseShiftModal(false)}
          onClosed={(result) => {
            if (result) {
              saveLatestClosedShiftNotice(result);
              setClosedShiftSummary(result);
            }
            void loadActiveShift();
          }}
        />
      )}
      {showBatchModal && (
        <BatchSelectorModal
          product={products.find(p => p.id === showBatchModal.productId) as any}
          onClose={() => setShowBatchModal(null)}
          onSelect={(batch) => {
            addToCart(products.find(p => p.id === showBatchModal.productId)!, batch);
            setShowBatchModal(null);
          }}
        />
      )}
      {isRecentSalesModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#5A5A40]">Последние продажи</h3>
              <button onClick={() => setIsRecentSalesModal(false)} className="p-2 hover:bg-[#f5f5f0] rounded-xl transition-colors"><Plus className="rotate-45" size={24} /></button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-2">
                {recentSales.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-4 bg-[#f5f5f0]/40 border border-[#5A5A40]/5 rounded-2xl">
                    <div>
                      <p className="font-bold text-[#5A5A40]">{s.invoiceNo}</p>
                      <p className="text-xs text-[#5A5A40]/60">{new Date(s.createdAt).toLocaleString()} • {s.totalAmount.toFixed(2)} TJS</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${s.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handlePrintReceipt(s)} className="p-2 bg-white border border-[#5A5A40]/10 rounded-xl hover:bg-[#f5f5f0] text-[#5A5A40]"><Barcode size={16} /></button>
                      {s.status !== 'CANCELLED' && (
                        <button onClick={() => handleVoidSale(s.id)} className="px-3 py-1 bg-red-50 text-red-600 text-xs font-bold rounded-xl hover:bg-red-100 transition-colors">Отменить</button>
                      )}
                    </div>
                  </div>
                ))}
                {recentSales.length === 0 && <div className="text-center py-8 text-[#5A5A40]/50">Нет недавних продаж</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
