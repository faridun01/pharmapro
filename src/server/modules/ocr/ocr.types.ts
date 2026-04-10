export type OcrConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface OcrResultItem {
  name: string;
  sku?: string;
  barcode?: string;
  quantity: number;
  costPrice: number;
  lineTotal?: number;
  batchNumber?: string;
  expiryDate?: string;
  confidence?: OcrConfidence;
  warnings?: string;
  needsReview?: boolean;
}

export interface OcrConfidenceSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  needsReview: number;
}

export interface OcrResult {
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  rawText: string;
  items: OcrResultItem[];
  confidenceSummary?: OcrConfidenceSummary;
}