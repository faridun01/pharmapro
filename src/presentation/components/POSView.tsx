import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';
import { saveLatestClosedShiftNotice } from '../../lib/shiftCloseNotice';
import { CloseShiftModal, OpenShiftModal } from './ShiftView';
import { 
  Search, 
  Barcode, 
  ShoppingCart, 
  Trash2, 
  Plus, 
  Minus, 
  CreditCard, 
  Wallet, 
  CheckCircle2,
  AlertCircle,
  Pill,
  User as UserIcon,
  CircleAlert,
  RefreshCw,
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

export const POSView: React.FC = () => {
  const { t } = useTranslation();
  const { products, customers, processTransaction, user } = usePharmacy();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [quickFilter, setQuickFilter] = useState<'ALL' | 'LOW_STOCK' | 'PRESCRIPTION' | 'MARKED'>('ALL');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [paymentType, setPaymentType] = useState<'CASH' | 'CARD' | 'CREDIT'>('CASH');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
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

  const cartProductIds = new Set(cart.map((item) => item.id));

  const categoryOptions = ['ALL', ...Array.from(new Set(products.map((product) => String(product.category || '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'))];

  const filteredProducts = products.filter((p) => {
    if (cartProductIds.has(p.id)) return false;
    if (p.totalStock <= 0) return false;
    if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
    if (quickFilter === 'LOW_STOCK' && p.totalStock >= (p.minStock || 10)) return false;
    if (quickFilter === 'PRESCRIPTION' && !p.prescription) return false;
    if (quickFilter === 'MARKED' && !p.markingRequired) return false;
    return (
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(p.barcode || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(p.manufacturer || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const getUnitsPerPack = (product: Pick<Product, 'unitsPerPack'>) => {
    const value = Number(product.unitsPerPack);
    return Number.isFinite(value) && value >= 2 ? value : null;
  };

  const formatPackQuantity = (quantity: number, unitsPerPack?: number) => {
    const safeUnitsPerPack = Number(unitsPerPack);
    if (!Number.isFinite(safeUnitsPerPack) || safeUnitsPerPack < 2) {
      return `${quantity} ед.`;
    }

    const boxes = Math.floor(quantity / safeUnitsPerPack);
    const units = quantity % safeUnitsPerPack;

    if (boxes > 0 && units > 0) {
      return `${boxes} кор. ${units} ед.`;
    }

    if (boxes > 0) {
      return `${boxes} кор.`;
    }

    return `${units} ед.`;
  };

  const getCartItemKey = (item: Pick<CartItem, 'id' | 'markingCode'>) => `${item.id}:${item.markingCode || 'default'}`;

  const findProductByScannedCode = (rawCode: string) => {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedCode = normalize(rawCode);
    if (!normalizedCode) return null;

    return (
      products.find((p) => normalize(p.sku) === normalizedCode) ||
      products.find((p) => normalize(p.barcode || '') === normalizedCode) ||
      products.find((p) => normalize(p.id) === normalizedCode) ||
      null
    );
  };

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  const loadActiveShift = useCallback(async () => {
    setShiftLoading(true);
    setShiftError(null);

    try {
      const response = await fetch('/api/shifts/active', {
        headers: await buildApiHeaders(),
      });

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

  // Global barcode listener (simulated)
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      const currentTime = Date.now();
      
      // If time between keys is very short, it's likely a scanner
      if (currentTime - lastKeyTime > 50) {
        buffer = '';
      }
      
      if (e.key === 'Enter') {
        if (buffer.length > 5) {
          const product = findProductByScannedCode(buffer);
          if (product) {
            addToCart(product);
          }
          buffer = '';
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
      
      lastKeyTime = currentTime;
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products]);

  const addToCart = (product: Product) => {
    if (product.totalStock <= 0) {
      setError('Товар закончился на складе');
      window.setTimeout(() => setError(null), 2000);
      return;
    }

    const existing = cart.find(item => item.id === product.id && !item.markingCode);
    if (existing) {
      setCart(cart.map(item => {
        if (item.id !== product.id || item.markingCode) return item;
        return { ...item, quantity: Math.min(item.totalStock, item.quantity + 1) };
      }));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
    setSearchTerm('');
  };

  const handleBarcodeScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const product = findProductByScannedCode(barcodeInput);
      if (product) {
        if (product.totalStock <= 0) {
          setError('Товар закончился на складе');
          setTimeout(() => setError(null), 3000);
        } else {
          addToCart(product);
        }
        setBarcodeInput('');
      } else {
        setError(`Товар по штрихкоду не найден: ${barcodeInput}`);
        setBarcodeInput('');
        setTimeout(() => setError(null), 3000);
      }
    }
  };

  const removeFromCart = (cartItemKey: string) => {
    setCart(cart.filter(item => getCartItemKey(item) !== cartItemKey));
  };

  const updateQuantity = (cartItemKey: string, delta: number) => {
    setCart(cart.map(item => {
      if (getCartItemKey(item) === cartItemKey) {
        return { ...item, quantity: Math.max(1, Math.min(item.totalStock, item.quantity + delta)) };
      }
      return item;
    }));
  };

  const updateQuantityFromPackaging = (cartItemKey: string, boxesValue: string, unitsValue: string) => {
    setCart(cart.map((item) => {
      if (getCartItemKey(item) !== cartItemKey) {
        return item;
      }

      const unitsPerPack = getUnitsPerPack(item);
      if (!unitsPerPack) {
        const parsedUnits = Number(unitsValue);
        if (!Number.isFinite(parsedUnits)) {
          return item;
        }

        return {
          ...item,
          quantity: Math.max(1, Math.min(item.totalStock, Math.floor(parsedUnits))),
        };
      }

      const parsedBoxes = Math.max(0, Math.floor(Number(boxesValue) || 0));
      const parsedUnits = Math.max(0, Math.floor(Number(unitsValue) || 0));
      const normalizedBoxes = parsedBoxes + Math.floor(parsedUnits / unitsPerPack);
      const normalizedUnits = parsedUnits % unitsPerPack;
      const totalUnits = normalizedBoxes * unitsPerPack + normalizedUnits;

      return {
        ...item,
        quantity: Math.max(1, Math.min(item.totalStock, totalUnits)),
      };
    }));
  };

  const subtotal = cart.reduce((acc, item) => acc + (item.sellingPrice * item.quantity), 0);
  const total = subtotal;
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || null;

  useEffect(() => {
    if (cart.length === 0) {
      setPaidAmountInput('');
    }
  }, [cart.length]);

  const handleComplete = async () => {
    if (cart.length === 0) return;

    if (!activeShift) {
      setError('Сначала откройте смену, затем оформляйте продажу');
      return;
    }

    const enteredPaidAmount = paidAmountInput.trim() === ''
      ? paymentType === 'CREDIT' ? 0 : total
      : Number(paidAmountInput);

    if (!Number.isFinite(enteredPaidAmount) || enteredPaidAmount < 0) {
      setError('Введите корректную сумму внесенных денег');
      return;
    }

    if (enteredPaidAmount < total && !selectedCustomerId) {
      setError('Для долга или частичной оплаты выберите клиента');
      return;
    }

    const paidAmount = Math.min(enteredPaidAmount, total);

    setProcessing(true);
    setError(null);
    try {
      await processTransaction({
        items: cart.map(item => ({
          productId: item.id,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice
        })),
        discountAmount: 0,
        taxAmount: 0,
        total,
        paymentType,
        customer: selectedCustomer?.name || 'Розничный покупатель',
        customerId: selectedCustomer?.id,
        paidAmount,
        userId: user?.id || '',
        date: new Date()
      });
      setSuccess(true);
      setCart([]);
      setSelectedCustomerId('');
      setPaidAmountInput('');
      void loadActiveShift();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Не удалось завершить продажу');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-3 h-[calc(100vh-12rem)] animate-in fade-in duration-500">
      {/* Left: Product Selection */}
      <div className="flex flex-col gap-4 overflow-hidden min-w-0">
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-[#5A5A40]/5 flex flex-col gap-4 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-[28px] font-bold text-[#5A5A40] leading-none">Кассовый терминал</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                Система онлайн
              </div>
              <button
                type="button"
                onClick={() => void loadActiveShift()}
                className="w-9 h-9 rounded-xl border border-[#5A5A40]/10 bg-white flex items-center justify-center text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
                title="Обновить статус смены"
              >
                <RefreshCw size={15} className={shiftLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 ${activeShift ? 'border-emerald-100 bg-emerald-50/80 text-emerald-700' : 'border-amber-100 bg-amber-50/80 text-amber-700'}`}>
            <div className="flex items-center gap-3 min-w-0">
              {activeShift ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {activeShift ? 'Смена открыта' : 'Смена не открыта'}
                </p>
                <p className="text-xs mt-1 truncate">
                  {activeShift
                    ? `${activeShift.shiftNo} • открыта ${new Date(activeShift.openAt).toLocaleString()}`
                    : (shiftError || 'Для оформления продажи сначала откройте смену в разделе смен.')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeShift ? (
                <button
                  type="button"
                  onClick={() => setIsCloseShiftModal(true)}
                  className="px-3 py-2 rounded-xl bg-[#5A5A40] text-white text-xs font-semibold hover:bg-[#4A4A30] transition-colors"
                >
                  Закрыть смену
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModal(true)}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                >
                  Открыть смену
                </button>
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
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Поиск товара по названию"
                className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 transition-all text-sm outline-none"
              />
            </div>
            <div className="relative group">
              <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 group-focus-within:text-[#5A5A40] transition-colors" size={18} />
              <input 
                ref={barcodeInputRef}
                type="text" 
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={handleBarcodeScan}
                placeholder="Сканируйте штрихкод"
                className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40]/20 transition-all text-sm outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: 'ALL', label: 'Все' },
                { value: 'LOW_STOCK', label: 'Низкий остаток' },
                { value: 'PRESCRIPTION', label: 'Rx' },
                { value: 'MARKED', label: 'Маркировка' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setQuickFilter(option.value as typeof quickFilter)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${quickFilter === option.value ? 'bg-[#5A5A40] text-white' : 'bg-[#f5f5f0] text-[#5A5A40]/70 hover:text-[#5A5A40]'}`}
                >
                  {option.label}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-[#5A5A40]/55">Найдено: {filteredProducts.length}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {categoryOptions.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-colors ${categoryFilter === category ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-[#5A5A40]/10 text-[#5A5A40]/70 hover:bg-[#f5f5f0]'}`}
                >
                  {category === 'ALL' ? 'Все категории' : category}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="space-y-2">
            {filteredProducts.map((product, index) => (
              (() => {
                const unitsPerPack = getUnitsPerPack(product);
                const stockLabel = formatPackQuantity(product.totalStock, unitsPerPack ?? undefined);
                const lowStock = product.totalStock < (product.minStock || 10);

                return (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                className="w-full bg-white px-4 py-3 rounded-2xl shadow-sm border border-[#5A5A40]/5 hover:shadow-md transition-all text-left group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 bg-[#f5f5f0] rounded-xl flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors shrink-0">
                    <span className="text-xs font-bold">{index + 1}</span>
                  </div>

                  <div className="min-w-0 flex-1 grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] items-center gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15px] font-bold text-[#5A5A40] truncate">{product.name}</h3>
                        {product.prescription && (
                          <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0">Rx</span>
                        )}
                      </div>
                      <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest mt-0.5">{product.sku}</p>
                    </div>

                    <p className="text-[11px] text-[#5A5A40]/60 text-left truncate">
                      {unitsPerPack ? `1 кор. = ${unitsPerPack} ед.` : 'Поштучно'}
                    </p>

                    <p className={`text-[10px] font-bold px-2 py-1 rounded-lg text-center w-fit ${lowStock ? 'bg-amber-100 text-amber-700' : 'bg-[#f5f5f0] text-[#5A5A40]/60'}`}>
                      {stockLabel}
                    </p>

                    <p className="text-[16px] font-bold text-[#5A5A40] leading-none text-right">{product.sellingPrice.toFixed(2)} TJS</p>
                  </div>
                </div>
              </button>
                );
              })()
            ))}
          </div>
        </div>
      </div>

      {/* Right: Cart & Checkout */}
      <div className="bg-white rounded-3xl shadow-xl border border-[#5A5A40]/5 flex flex-col overflow-hidden min-w-0">
        <div className="p-3 border-b border-[#5A5A40]/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart size={17} className="text-[#5A5A40]" />
            <h3 className="text-[15px] font-bold text-[#5A5A40]">Текущий заказ</h3>
          </div>
          <span className="bg-[#f5f5f0] text-[#5A5A40] text-[11px] font-bold px-2 py-1 rounded-lg">
            {cart.length} позиций
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
          {cart.length > 0 ? (
            cart.map((item) => {
              const cartItemKey = getCartItemKey(item);
              const unitsPerPack = getUnitsPerPack(item);
              const boxes = unitsPerPack ? Math.floor(item.quantity / unitsPerPack) : 0;
              const units = unitsPerPack ? item.quantity % unitsPerPack : item.quantity;

              return (
              <div key={cartItemKey} className="p-2 bg-[#f5f5f0]/50 rounded-xl border border-[#5A5A40]/5 group space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[12px] font-bold text-[#5A5A40] truncate leading-tight">{item.name}</h4>
                    <p className="text-[10px] text-[#5A5A40]/55 mt-0.5 leading-tight">
                      {item.sellingPrice.toFixed(2)} TJS / ед. • Остаток: {formatPackQuantity(item.totalStock, unitsPerPack ?? undefined)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <p className="text-[12px] font-bold text-[#5A5A40]">{(item.sellingPrice * item.quantity).toFixed(2)} TJS</p>
                    <button 
                      onClick={() => removeFromCart(cartItemKey)}
                      className="p-1 text-[#5A5A40]/35 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button 
                    onClick={() => updateQuantity(cartItemKey, -1)}
                    className="w-5 h-5 bg-white rounded-md flex items-center justify-center text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white transition-colors shadow-sm"
                  >
                    <Minus size={11} />
                  </button>
                  <span className="text-[11px] font-bold text-[#5A5A40] min-w-14 text-center">{formatPackQuantity(item.quantity, unitsPerPack ?? undefined)}</span>
                  <button 
                    onClick={() => updateQuantity(cartItemKey, 1)}
                    className="w-5 h-5 bg-white rounded-md flex items-center justify-center text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white transition-colors shadow-sm"
                  >
                    <Plus size={11} />
                  </button>

                  {unitsPerPack ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={boxes}
                        onChange={(e) => updateQuantityFromPackaging(cartItemKey, e.target.value, String(units))}
                        className="w-16 px-2 py-1 bg-white border border-[#5A5A40]/10 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#5A5A40]/15"
                        placeholder="кор."
                        aria-label="Коробки"
                      />
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={units}
                        onChange={(e) => updateQuantityFromPackaging(cartItemKey, String(boxes), e.target.value)}
                        className="w-16 px-2 py-1 bg-white border border-[#5A5A40]/10 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#5A5A40]/15"
                        placeholder="ед."
                        aria-label="Единицы"
                      />
                    </>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={item.quantity}
                      onChange={(e) => updateQuantityFromPackaging(cartItemKey, '0', e.target.value)}
                      className="w-20 px-2 py-1 bg-white border border-[#5A5A40]/10 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#5A5A40]/15"
                      placeholder="ед."
                      aria-label="Единицы"
                    />
                  )}
                </div>
              </div>
              );
            })
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-[#5A5A40]/30 text-center p-6">
              <ShoppingCart size={38} strokeWidth={1.1} className="mb-3" />
              <p className="text-[13px] font-medium italic">Корзина пуста.<br/>Выберите товары для начала.</p>
            </div>
          )}
        </div>

        <div className="p-3 bg-[#f5f5f0]/50 border-t border-[#5A5A40]/5 space-y-2.5 shrink-0">
          <div className="space-y-1.5">
            <div className="flex justify-between text-[18px] font-bold text-[#5A5A40] pt-2 border-t border-[#5A5A40]/10">
              <span>Итого</span>
              <span>{total.toFixed(2)} TJS</span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-[#5A5A40]/10 space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Внесено</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step="0.01"
                value={paidAmountInput}
                onChange={(e) => setPaidAmountInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#5A5A40]/15 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={() => setPaidAmountInput(total > 0 ? total.toFixed(2) : '')}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-[#5A5A40]/15 text-[12px] font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
              >
                Все
              </button>
            </div>
            <p className="text-[11px] text-[#5A5A40]/60">
              {(() => {
                const entered = Number(paidAmountInput || 0);
                if (!Number.isFinite(entered) || entered <= 0) return 'Если не внесено - будет долг';
                if (entered < total) return `Частичная оплата: остаток ${(total - entered).toFixed(2)} TJS`;
                return 'Оплачено полностью';
              })()}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button 
              onClick={() => setPaymentType('CASH')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CASH' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}
            >
              <Wallet size={14} />
              Наличные
            </button>
            <button 
              onClick={() => setPaymentType('CARD')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CARD' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}
            >
              <CreditCard size={14} />
              Карта
            </button>
            <button
              onClick={() => setPaymentType('CREDIT')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-[12px] transition-all ${paymentType === 'CREDIT' ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-white/80'}`}
            >
              <Wallet size={14} />
              В долг
            </button>
          </div>

          <div className="relative group">
            <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={16} />
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-[#5A5A40]/10 rounded-xl text-[12px] outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all appearance-none"
            >
              <option value="">Розничный покупатель</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          {selectedCustomer && (
            <div className="p-2.5 bg-white text-[#5A5A40]/70 text-[11px] rounded-lg border border-[#5A5A40]/10 flex items-center justify-between gap-2">
              <span>{selectedCustomer.managerName || selectedCustomer.phone || selectedCustomer.email || selectedCustomer.name}</span>
              <span>Лимит: {selectedCustomer.creditLimit.toFixed(2)} TJS</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 text-emerald-600 text-xs rounded-lg border border-emerald-100 flex items-center gap-2">
              <CheckCircle2 size={14} />
              Продажа успешно завершена
            </div>
          )}

          <button 
            onClick={handleComplete}
            disabled={cart.length === 0 || processing || !activeShift || shiftLoading}
            className="w-full bg-[#5A5A40] text-white py-2.5 rounded-2xl font-bold shadow-xl hover:bg-[#4A4A30] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100"
          >
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
