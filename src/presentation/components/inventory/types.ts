import { Product } from '../../../core/domain';

export type NewProductForm = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  manufacturer: string;
  countryOfOrigin: string;
  minStock: number;
  costPrice: number;
  sellingPrice: number;
  prescription: boolean;
  markingRequired: boolean;
  batchNumber: string;
  expiryDate: string;
  initialUnits: number;
};

export type PriceEditModalState = {
  product: Product;
  costPrice: string;
  sellingPrice: string;
};

export type PriceHistoryEntry = {
  id: string;
  createdAt: string;
  actorName: string;
  costPrice: { old: number | null; new: number | null };
  sellingPrice: { old: number | null; new: number | null };
};

export type BarcodeEditModalState = {
  product: Product;
  barcode: string;
};

export type RestockModalState = {
  open: boolean;
  productId: string;
  batchNumber: string;
  quantity: string;
  unit: string;
  costBasis: string;
  expiryDate: string;
  error: string | null;
};
