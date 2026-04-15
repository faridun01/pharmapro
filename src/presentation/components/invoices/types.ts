import { Invoice } from '../../../core/domain';

export type DateFilterMode = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';

export type EditableInvoiceItem = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
};

export type ReturnInvoiceItem = {
  id: string;
  productId?: string;
  productName: string;
  batchNo: string;
  soldQuantity: number;
  quantity: number;
};

export type InvoiceDisplayItem = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

