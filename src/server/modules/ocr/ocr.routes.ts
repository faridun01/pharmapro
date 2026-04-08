import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { findExistingProductByName } from '../../common/productName';
import { prisma } from '../../infrastructure/prisma';
import { inventoryService } from '../inventory/inventory.service';
import { checkOllamaAvailability, getOllamaModelName, runOllamaTextNormalization, runOllamaVisionOcr } from './ollama.engine';
import { runPdfOcr } from './pdf.engine';

// --- Types ---

type ParsedInvoiceItem = {
  lineId?: string;
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
};

const DEFAULT_BATCH_UNIT = 'units';

const getBatchStatus = (expiryDate: Date): 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED' => {
  const now = new Date();
  const diffDays = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'EXPIRED';
  if (diffDays <= 30) return 'CRITICAL';
  if (diffDays <= 90) return 'NEAR_EXPIRY';
  return 'STABLE';
};

// --- Shared helpers ---

const normalizeCode = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeDateString = (value?: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().split('T')[0];
};

const findBestProductMatch = (
  item: ParsedInvoiceItem,
  products: Array<{ id: string; name: string; sku: string; costPrice: number }>,
) => {
  const skuCode = item.sku ? normalizeCode(item.sku) : '';
  if (skuCode) {
    const exact = products.find((p) => normalizeCode(p.sku) === skuCode);
    if (exact) return exact;
  }
  const nameCode = normalizeCode(item.name);
  if (!nameCode) return null;
  return (
    products.find((p) => {
      const pn = normalizeCode(p.name);
      return pn.includes(nameCode) || nameCode.includes(pn);
    }) ?? null
  );
};

const buildNormalizedItems = (
  rawItems: ParsedInvoiceItem[],
  products: Array<{ id: string; name: string; sku: string; costPrice: number }>,
) =>
  rawItems
    .filter((item) => item?.name)
    .map((item, index) => {
      const matched = findBestProductMatch(item, products);
      const warnings: string[] = [];
      if (!matched) warnings.push('No product match');
      if (!item.quantity || Number(item.quantity) <= 0) warnings.push('Missing quantity');
      if (!item.costPrice || Number(item.costPrice) <= 0) warnings.push('Missing price');
      const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = matched && warnings.length === 0
        ? 'HIGH'
        : matched || warnings.length <= 1
          ? 'MEDIUM'
          : 'LOW';
      return {
        lineId: `ocr-${Date.now()}-${index}`,
        productId: matched?.id || null,
        name: item.name.trim(),
        sku: item.sku?.trim() || '',
        barcode: item.barcode?.trim() || '',
        quantity: Math.max(1, Number(item.quantity) || 1),
        costPrice: Number(item.costPrice) || matched?.costPrice || 0,
        batchNumber: item.batchNumber?.trim() || `B-${Date.now().toString().slice(-6)}-${index + 1}`,
        expiryDate:
          normalizeDateString(item.expiryDate) ||
          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        confidence,
        warnings: warnings.join('; '),
        needsReview: !matched || confidence === 'LOW',
      };
    });

const pickExistingUserId = async (reqUser?: { id?: string; email?: string }) => {
  if (reqUser?.id) {
    const userById = await prisma.user.findUnique({ where: { id: reqUser.id }, select: { id: true } });
    if (userById) return userById.id;
  }

  if (reqUser?.email) {
    const userByEmail = await prisma.user.findUnique({ where: { email: reqUser.email }, select: { id: true } });
    if (userByEmail) return userByEmail.id;
  }

  const firstUser = await prisma.user.findFirst({ select: { id: true } });
  if (firstUser) return firstUser.id;

  const fallback = await prisma.user.create({
    data: {
      email: reqUser?.email || 'admin@pharmapro.local',
      password: await bcrypt.hash('dev-password', 12),
      name: 'System User',
      role: 'ADMIN',
    },
    select: { id: true },
  });

  return fallback.id;
};

const buildReviewStats = (
  items: Array<{ confidence?: 'HIGH' | 'MEDIUM' | 'LOW'; needsReview?: boolean }>,
) => {
  const total = items.length;
  const high = items.filter((i) => i.confidence === 'HIGH').length;
  const medium = items.filter((i) => i.confidence === 'MEDIUM').length;
  const low = items.filter((i) => i.confidence === 'LOW').length;
  const needsReview = items.filter((i) => i.needsReview).length;
  return { total, high, medium, low, needsReview };
};

// --- Router ---

export const ocrRouter = Router();

/** GET /engines - tells the frontend which engines are available */
ocrRouter.get('/engines', async (_req, res) => {
  res.json({ ollama: await checkOllamaAvailability(), model: getOllamaModelName() });
});

/**
 * POST /
 * body: { imageBase64, mimeType?, engine?: 'ollama' }
 */
ocrRouter.post('/', asyncHandler(async (req, res) => {
  const { imageBase64, mimeType = 'image/png' } = req.body ?? {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new ValidationError('imageBase64 is required');
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true, costPrice: true },
  });

  const parsed = await runOllamaVisionOcr(imageBase64, mimeType);
  if (!parsed.items.length) {
    return res.status(422).json({
      error: 'Ollama не смог распознать позиции накладной. Проверьте качество изображения или модель gemma3:4b.',
    });
  }
  return res.json({
    engine: 'ollama',
    invoiceNumber: parsed.invoiceNumber,
    supplierName: parsed.supplierName,
    invoiceDate: parsed.invoiceDate,
    items: buildNormalizedItems(parsed.items, products),
  });
}));

/**
 * POST /drafts
 * Runs OCR and creates a persisted review draft with OcrDocument/OcrRow/OcrImportDraft.
 */
ocrRouter.post('/drafts', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { imageBase64, mimeType = 'image/png' } = req.body ?? {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new ValidationError('imageBase64 is required');
  }

  const isPdf = mimeType === 'application/pdf' || mimeType === 'pdf';

  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true, costPrice: true },
  });

  let parsedHeader: { invoiceNumber?: string; supplierName?: string; invoiceDate?: string; items?: ParsedInvoiceItem[]; rawText?: string };
  let resolvedEngine: 'ollama' | 'pdf+ollama';

  if (isPdf) {
    const pdfParsed = await runPdfOcr(imageBase64);
    parsedHeader = await runOllamaTextNormalization(pdfParsed.rawText || '');
    if (!parsedHeader.invoiceNumber) parsedHeader.invoiceNumber = pdfParsed.invoiceNumber;
    if (!parsedHeader.supplierName) parsedHeader.supplierName = pdfParsed.supplierName;
    if (!parsedHeader.invoiceDate) parsedHeader.invoiceDate = pdfParsed.invoiceDate;
    if (!parsedHeader.rawText) parsedHeader.rawText = pdfParsed.rawText;
    resolvedEngine = 'pdf+ollama';
  } else {
    parsedHeader = await runOllamaVisionOcr(imageBase64, mimeType);
    resolvedEngine = 'ollama';
  }

  const normalizedItems = buildNormalizedItems(parsedHeader.items || [], products);
  if (!normalizedItems.length) {
    // Return 200 with empty items + rawText so the frontend can show what was extracted
    return res.status(200).json({
      engine: resolvedEngine,
      draftId: null,
      documentId: null,
      invoiceNumber: parsedHeader.invoiceNumber?.trim() || '',
      supplierName: parsedHeader.supplierName?.trim() || '',
      invoiceDate: normalizeDateString(parsedHeader.invoiceDate) || new Date().toISOString().split('T')[0],
      rawText: parsedHeader.rawText || '',
      review: { total: 0, high: 0, medium: 0, low: 0, needsReview: 0 },
      items: [],
      warning: 'Не удалось распознать позиции накладной. Проверьте качество изображения или введите данные вручную.',
    });
  }

  const uploadedById = await pickExistingUserId(authedReq.user);
  const supplierName = parsedHeader.supplierName?.trim() || '';
  const supplierMatch = supplierName
    ? await prisma.supplier.findFirst({
      where: { name: { contains: supplierName } },
      select: { id: true },
    })
    : null;

  const invoiceDateIso = normalizeDateString(parsedHeader.invoiceDate) || new Date().toISOString().split('T')[0];
  const nowStamp = Date.now().toString().slice(-6);

  const createdDraft = await prisma.$transaction(async (tx) => {
    const document = await tx.ocrDocument.create({
      data: {
        documentNo: `OCR-${nowStamp}-${Math.floor(Math.random() * 1000)}`,
        supplierId: supplierMatch?.id,
        uploadedById,
        fileName: `upload-${Date.now()}.png`,
        mimeType,
        status: normalizedItems.some((i) => i.needsReview) ? 'NEEDS_REVIEW' : 'MATCHED',
        rawText: parsedHeader.rawText || null,
        normalizedJson: JSON.stringify({
          invoiceNumber: parsedHeader.invoiceNumber || '',
          supplierName,
          invoiceDate: invoiceDateIso,
          items: normalizedItems,
        }),
        invoiceNumber: parsedHeader.invoiceNumber?.trim() || null,
        invoiceDate: new Date(invoiceDateIso),
      },
    });

    await tx.ocrRow.createMany({
      data: normalizedItems.map((item, index) => ({
        documentId: document.id,
        lineNo: index + 1,
        rawLine: item.name,
        productName: item.name,
        sku: item.sku || null,
        barcode: item.barcode || null,
        quantity: Number(item.quantity) || 1,
        unit: DEFAULT_BATCH_UNIT,
        purchasePrice: Number(item.costPrice) || 0,
        total: (Number(item.quantity) || 1) * (Number(item.costPrice) || 0),
        batchNumber: item.batchNumber || null,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        matchedProductId: item.productId || null,
        confidence: item.confidence || 'LOW',
        warnings: item.warnings || null,
        needsReview: !!item.needsReview,
      })),
    });

    const draft = await tx.ocrImportDraft.create({
      data: {
        documentId: document.id,
        summary: `Engine: ${resolvedEngine}; rows: ${normalizedItems.length}`,
      },
      select: { id: true },
    });

    return { documentId: document.id, draftId: draft.id };
  });

  return res.status(201).json({
    engine: resolvedEngine,
    draftId: createdDraft.draftId,
    documentId: createdDraft.documentId,
    invoiceNumber: parsedHeader.invoiceNumber?.trim() || '',
    supplierName,
    invoiceDate: invoiceDateIso,
    rawText: parsedHeader.rawText || '',
    review: buildReviewStats(normalizedItems),
    items: normalizedItems,
  });
}));

/**
 * POST /drafts/:id/import
 * Finalizes reviewed OCR rows and imports them into stock.
 */
ocrRouter.post('/drafts/:id/import', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const draftId = req.params.id;
  const {
    supplierId,
    invoiceNumber,
    invoiceDate,
    createMissingProducts = true,
    items,
  } = req.body ?? {};

  const draft = await prisma.ocrImportDraft.findUnique({
    where: { id: draftId },
    include: {
      document: {
        include: {
          rows: true,
          supplier: true,
        },
      },
    },
  });

  if (!draft) throw new ValidationError('OCR draft not found');
  if (draft.imported) throw new ValidationError('This OCR draft is already imported');

  const importedById = await pickExistingUserId(authedReq.user);

  const reviewedItems = Array.isArray(items) && items.length
    ? items
    : draft.document.rows.map((row) => ({
      lineId: row.id,
      productId: row.matchedProductId,
      name: row.productName || row.rawLine || 'Imported item',
      sku: row.sku || '',
      barcode: row.barcode || '',
      quantity: Number(row.quantity) || 1,
      costPrice: Number(row.purchasePrice) || 0,
      batchNumber: row.batchNumber || '',
      expiryDate: row.expiryDate?.toISOString().split('T')[0],
      confidence: row.confidence,
      warnings: row.warnings || '',
      needsReview: row.needsReview,
    }));

  const finalizedItems = reviewedItems
    .filter((item: any) => item?.name)
    .map((item: any, index: number) => ({
      lineId: item.lineId || `review-${index}`,
      productId: item.productId || null,
      name: String(item.name).trim(),
      sku: String(item.sku || '').trim(),
      barcode: String(item.barcode || '').trim(),
      quantity: Math.max(1, Number(item.quantity) || 1),
      costPrice: Math.max(0, Number(item.costPrice) || 0),
      batchNumber: String(item.batchNumber || `B-${Date.now().toString().slice(-6)}-${index + 1}`).trim(),
      expiryDate: normalizeDateString(item.expiryDate)
        || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      confidence: item.confidence || 'LOW',
      warnings: String(item.warnings || ''),
      needsReview: !!item.needsReview,
    }));

  if (!finalizedItems.length) throw new ValidationError('No import rows were provided');

  const defaultSupplierId = supplierId || draft.document.supplierId || null;
  const importDate = normalizeDateString(invoiceDate)
    || (draft.document.invoiceDate?.toISOString().split('T')[0] ?? new Date().toISOString().split('T')[0]);

  if (!defaultSupplierId) {
    throw new ValidationError('supplierId is required to import OCR draft');
  }

  const importItems: Array<{
    productId: string;
    batchNumber: string;
    quantity: number;
    unit: string;
    costBasis: number;
    manufacturedDate: Date;
    expiryDate: Date;
  }> = [];

  for (const item of finalizedItems) {
    let productId = item.productId as string | null;

    if (!productId) {
      if (!createMissingProducts) {
        throw new ValidationError(`Missing product match for: ${item.name}`);
      }
      const existingProduct = await findExistingProductByName(item.name);
      if (existingProduct) {
        productId = existingProduct.id;
      } else {
        const createdProduct = await prisma.product.create({
          data: {
            name: item.name,
            sku: item.sku || `${item.name.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${Date.now().toString().slice(-5)}`,
            barcode: item.barcode || null,
            category: 'Imported',
            manufacturer: draft.document.supplier?.name || 'Invoice Import',
            minStock: 10,
            costPrice: item.costPrice || 0,
            sellingPrice: Number((item.costPrice * 1.35).toFixed(2)),
            status: 'ACTIVE',
            image: null,
            prescription: false,
            markingRequired: false,
          },
          select: { id: true },
        });
        productId = createdProduct.id;
      }
    }

    importItems.push({
      productId,
      batchNumber: item.batchNumber,
      quantity: item.quantity,
      unit: DEFAULT_BATCH_UNIT,
      costBasis: item.costPrice,
      manufacturedDate: new Date(new Date(importDate).getTime() - 180 * 24 * 60 * 60 * 1000),
      expiryDate: new Date(item.expiryDate),
    });
  }

  const purchaseInvoice = await inventoryService.importPurchaseInvoice({
    supplierId: defaultSupplierId,
    invoiceNumber: invoiceNumber || draft.document.invoiceNumber || `OCR-IMPORT-${Date.now()}`,
    invoiceDate: new Date(importDate),
    comment: `Imported from OCR draft ${draft.id}`,
    items: importItems,
  }, importedById);

  const importedRows = await prisma.$transaction(async (tx) => {
    await tx.ocrRow.deleteMany({ where: { documentId: draft.documentId } });
    await tx.ocrRow.createMany({
      data: finalizedItems.map((item: any, index: number) => ({
        documentId: draft.documentId,
        lineNo: index + 1,
        rawLine: item.name,
        productName: item.name,
        sku: item.sku || null,
        barcode: item.barcode || null,
        quantity: item.quantity,
        unit: DEFAULT_BATCH_UNIT,
        purchasePrice: item.costPrice,
        total: item.quantity * item.costPrice,
        batchNumber: item.batchNumber,
        expiryDate: new Date(item.expiryDate),
        matchedProductId: importItems[index]?.productId || item.productId,
        confidence: item.confidence,
        warnings: item.warnings || null,
        needsReview: false,
      })),
    });

    await tx.ocrDocument.update({
      where: { id: draft.documentId },
      data: {
        status: 'IMPORTED',
        supplierId: defaultSupplierId,
        invoiceNumber: purchaseInvoice.invoiceNumber,
        invoiceDate: new Date(importDate),
      },
    });

    await tx.ocrImportDraft.update({
      where: { id: draft.id },
      data: {
        imported: true,
        approvedById: importedById,
        summary: `Imported ${finalizedItems.length} rows into purchase invoice ${purchaseInvoice.invoiceNumber}`,
      },
    });

    return finalizedItems.length;
  });

  return res.json({
    importedRows,
    draftId,
    documentId: draft.documentId,
    purchaseInvoiceId: purchaseInvoice.id,
    status: 'IMPORTED',
  });
}));
