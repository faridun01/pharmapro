import { InvoiceDisplayItem } from './types';

export const formatPackQuantity = (quantity: number) => {
  const wholeQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
  return `${wholeQuantity} ед.`;
};

export const buildInvoiceDisplayItems = (items: any[] = []): InvoiceDisplayItem[] => {
  const grouped = new Map<string, InvoiceDisplayItem>();

  for (const item of items) {
    const productName = String(item?.productName || '-').trim() || '-';
    const productId = item?.productId ? String(item.productId) : undefined;
    const key = productId || productName.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
    const quantity = Math.max(0, Math.floor(Number(item?.quantity || 0)));
    const unitPrice = Number(item?.unitPrice || 0);
    const totalPrice = Number(item?.totalPrice || 0);
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.totalPrice += totalPrice;
      continue;
    }

    grouped.set(key, {
      id: String(item?.id || key),
      productId,
      productName,
      quantity,
      unitPrice,
      totalPrice,
    });
  }

  return [...grouped.values()];
};

export const getInvoiceOutstandingAmount = (invoice: any) => Number(
  invoice?.outstandingAmount
    ?? invoice?.receivables?.[0]?.remainingAmount
    ?? invoice?.totalAmount
    ?? 0
);

export const getPaymentStatusLabel = (paymentState: string, outstandingAmount: number, paidAmount = 0) => {
  if (outstandingAmount <= 0 || paymentState === 'PAID') {
    return { label: 'Оплачено', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }

  if (paymentState === 'PARTIALLY_PAID' || paidAmount > 0) {
    return { label: 'Частично оплачено', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  }

  return { label: 'Долг', className: 'bg-rose-50 text-rose-700 border-rose-200' };
};
