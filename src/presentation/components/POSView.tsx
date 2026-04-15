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
  markingCode?: string;
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

export const POSView: React.FC = () => {
  const { products, refreshProducts, processTransaction, user } = usePharmacy();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [paymentType, setPaymentType] = useState<'CASH' | 'CARD' | 'CREDIT'>('CASH');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [creditCustomerName, setCreditCustomerName] = useState('');
  const [creditCustomerPhone, setCreditCustomerPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [isOpenShiftModal, setIsOpenShiftModal] = useState(false);
  const [isCloseShiftModal, setIsCloseShiftModal] = useState(false);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ClosedShiftSummary | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [barcodeScanning, setBarcodeScanning] = useState(false);

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

  const getCartItemKey = useCallback((item: Pick<CartItem, 'id' | 'markingCode'>) => `${item.id}:${item.markingCode || 'default'}`, []);
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

  const addToCart = useCallback((product: Product) => {
    if (product.totalStock <= 0) {
      setError('Товар закончился на складе');
      window.setTimeout(() => setError(null), 2000);
      return;
    }
    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.id === product.id && !item.markingCode);
      if (existing) {
        return currentCart.map((item) => {
          if (item.id !== product.id || item.markingCode) return item;
          return { ...item, quantity: Math.min(item.totalStock, item.quantity + 1) };
        });
      }
      return [...currentCart, { ...product, quantity: 1 }];
    });
  }, []);

  const subtotal = useMemo(() => cart.reduce((acc, item) => acc + (item.sellingPrice * item.quantity), 0), [cart]);
  const total = subtotal;
  const isCreditSale = paymentType === 'CREDIT';
  const enteredPaidAmountPreview = paidAmountInput.trim() === '' ? (isCreditSale ? 0 : total) : Number(paidAmountInput);
  const outstandingAmount = Number.isFinite(enteredPaidAmountPreview)
    ? Math.max(0, total - Math.min(enteredPaidAmountPreview, total))
    : total;
  const needsDebtorDetails = isCreditSale || outstandingAmount > 0.009;

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

  useEffect(() => {
    void loadActiveShift();
    const handleFocus = () => {
      void loadActiveShift();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadActiveShift]);

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

  useLayoutEffect(() => {
    if (cart.length === 0) {
      setPaidAmountInput('');
      setCreditCustomerName('');
      setCreditCustomerPhone('');
    }
  }, [cart.length]);

  useLayoutEffect(() => {
    if (paymentType === 'CREDIT') return;
    setPaidAmountInput(total > 0 ? total.toFixed(2) : '');
  }, [paymentType, total]);

  const handleComplete = async () => {
    if (cart.length === 0) return;
    if (!activeShift) {
      setError('Сначала откройте смену, затем оформляйте продажу');
      return;
    }
    const enteredPaidAmount = paidAmountInput.trim() === '' ? (isCreditSale ? 0 : total) : Number(paidAmountInput);
    if (!Number.isFinite(enteredPaidAmount) || enteredPaidAmount < 0) {
      setError('Введите корректную сумму внесенных денег');
      return;
    }
    if (enteredPaidAmount < total && !creditCustomerName.trim()) {
      setError('Для продажи в долг укажите имя покупателя');
      return;
    }
    const paidAmount = Math.min(enteredPaidAmount, total);
    setProcessing(true);
    setError(null);
    try {
      await processTransaction({
        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity, sellingPrice: item.sellingPrice })),
        discountAmount: 0,
        taxAmount: 0,
        total,
        paymentType,
        customer: enteredPaidAmount < total ? creditCustomerName.trim() : undefined,
        customerPhone: enteredPaidAmount < total ? creditCustomerPhone.trim() : undefined,
        paidAmount,
        userId: user?.id || '',
        date: new Date(),
      });
      setSuccess(true);
      setCart([]);
      setCreditCustomerName('');
      setCreditCustomerPhone('');
      setPaidAmountInput('');
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
                {activeShift ? (
                  <button type="button" onClick={() => setIsCloseShiftModal(true)} className="px-3 py-2 rounded-xl bg-[#5A5A40] text-white text-xs font-semibold hover:bg-[#4A4A30] transition-colors">Закрыть смену</button>
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

          <ProductCatalog filteredProducts={filteredProducts} onAddToCart={addToCart} />
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
                        {metaBadges.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {item.countryOfOrigin && <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-semibold text-sky-700">{item.countryOfOrigin}</span>}
                          </div>
                        )}
                        <p className="text-[10px] text-[#5A5A40]/55 mt-0.5 leading-tight">{item.sellingPrice.toFixed(2)} TJS / ед. • Остаток: {formatUnitQuantity(item.totalStock)}</p>
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
              <div className="flex justify-between text-[18px] font-bold text-[#5A5A40] pt-2 border-t border-[#5A5A40]/10">
                <span>Итого</span>
                <span className="tabular-nums min-w-30 text-right">{total.toFixed(2)} TJS</span>
              </div>
            </div>

            <div className="bg-white p-2.5 rounded-xl border border-[#5A5A40]/10 space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Внесено</label>
              <div className="flex items-center gap-2">
                <input type="number" min={0} step="0.01" value={paidAmountInput} onChange={(event) => setPaidAmountInput(event.target.value)} className="w-full px-3 py-1.5 border border-[#5A5A40]/15 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#5A5A40]/20 tabular-nums" placeholder="0.00" />
                <button type="button" onClick={() => setPaidAmountInput(total > 0 ? total.toFixed(2) : '')} className="shrink-0 px-3 py-1.5 rounded-lg border border-[#5A5A40]/15 text-[12px] font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors">Все</button>
              </div>
              <p className="text-[11px] text-[#5A5A40]/60 min-h-4">
                {(() => {
                  const entered = Number(paidAmountInput || 0);
                  if (!Number.isFinite(entered) || entered <= 0) return '';
                  if (entered < total) return `Частичная оплата: остаток ${(total - entered).toFixed(2)} TJS`;
                  return 'Оплачено полностью';
                })()}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setPaymentType('CASH')} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CASH' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}>
                <Wallet size={14} />
                Наличные
              </button>
              <button onClick={() => setPaymentType('CARD')} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CARD' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}>
                <CreditCard size={14} />
                Карта
              </button>
              <button onClick={() => { setPaymentType('CREDIT'); setPaidAmountInput(''); }} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CREDIT' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}>
                <Wallet size={14} />
                В долг
              </button>
            </div>

            {needsDebtorDetails && (
              <div className="bg-white p-2.5 rounded-xl border border-[#5A5A40]/10 space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#5A5A40]/55">
                  <UserIcon size={14} />
                  Покупатель для долга
                </div>
                <input type="text" value={creditCustomerName} onChange={(event) => setCreditCustomerName(event.target.value)} className="w-full px-3 py-2 border border-[#5A5A40]/15 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="Имя покупателя" />
                <input type="text" value={creditCustomerPhone} onChange={(event) => setCreditCustomerPhone(event.target.value)} className="w-full px-3 py-2 border border-[#5A5A40]/15 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#5A5A40]/20" placeholder="Номер телефона (необязательно)" />
                <p className="text-[11px] text-[#5A5A40]/55">Продажа в долг спишет остаток со склада и создаст запись в разделе должников.</p>
              </div>
            )}

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
    </>
  );
};
