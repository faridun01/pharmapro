export interface OcrResult {
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  rawText: string;
  items: Array<{
    name: string;
    sku?: string;
    barcode?: string;
    quantity: number;
    costPrice: number;
    lineTotal?: number;
    batchNumber?: string;
    expiryDate?: string;
  }>;
}