import { Router } from 'express';
import { authenticate, requireRole } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { buildXlsxBuffer, setXlsxHeaders, fmt } from '../../common/excel';

export const exportRouter = Router();

// ─── Helper ────────────────────────────────────────────────────────────────

const parseDate = (v: unknown) => {
  if (!v) return undefined;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
};

// ─── GET /api/export/products ───────────────────────────────────────────────
// Full product catalogue with stock levels and prices.
exportRouter.get(
  '/products',
  authenticate,
  requireRole(['ADMIN', 'OWNER', 'PHARMACIST', 'WAREHOUSE_STAFF']),
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        },
        warehouseStocks: { include: { warehouse: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    const rows = products.map((p) => {
      const nearestExpiry = p.batches[0]?.expiryDate ?? null;
      const warehouseNames = p.warehouseStocks
        .filter((ws) => (ws.quantity || 0) > 0)
        .map((ws) => `${ws.warehouse.name}: ${ws.quantity}`)
        .join('; ');

      return {
        name: p.name,
        sku: p.sku,
        barcode: p.barcode ?? '—',
        category: p.category ?? '—',
        manufacturer: p.manufacturer ?? '—',
        countryOfOrigin: p.countryOfOrigin ?? '—',
        totalStock: fmt.qty(p.totalStock),
        minStock: fmt.qty(p.minStock),
        status: p.status,
        sellingPrice: fmt.money(p.sellingPrice),
        costPrice: fmt.money(p.costPrice),
        nearestExpiry: fmt.date(nearestExpiry),
        batchCount: p.batches.length,
        warehouseBreakdown: warehouseNames || '—',
        prescription: p.prescription ? 'Да' : 'Нет',
      };
    });

    const columns = [
      { key: 'name',              header: 'Наименование',       width: 35 },
      { key: 'sku',               header: 'Артикул',            width: 15 },
      { key: 'barcode',           header: 'Штрихкод',           width: 18 },
      { key: 'category',          header: 'Категория',          width: 18 },
      { key: 'manufacturer',      header: 'Производитель',      width: 22 },
      { key: 'countryOfOrigin',   header: 'Страна',             width: 14 },
      { key: 'totalStock',        header: 'Остаток',            width: 12 },
      { key: 'minStock',          header: 'Мин. остаток',       width: 13 },
      { key: 'status',            header: 'Статус',             width: 14 },
      { key: 'sellingPrice',      header: 'Цена продажи',       width: 14 },
      { key: 'costPrice',         header: 'Себестоимость',      width: 15 },
      { key: 'nearestExpiry',     header: 'Ближ. срок годн.',   width: 18 },
      { key: 'batchCount',        header: 'Партий',             width: 10 },
      { key: 'warehouseBreakdown',header: 'По складам',         width: 40 },
      { key: 'prescription',      header: 'Рецептурный',        width: 14 },
    ];

    const buf = buildXlsxBuffer([{ name: 'Товары', rows, columns }]);
    setXlsxHeaders(res, `Товары_${fmt.date(new Date())}`);
    res.send(buf);
  }),
);

// ─── GET /api/export/sales ─────────────────────────────────────────────────
// Sales invoices with optional date range.
exportRouter.get(
  '/sales',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const from = parseDate(req.query.from);
    const to   = parseDate(req.query.to);

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to   ? { lte: to }   : {}),
          },
        } : {}),
      },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
        payments: { select: { method: true, amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Sheet 1: Summary per invoice
    const summaryRows = invoices.map((inv) => ({
      invoiceNo: inv.invoiceNo,
      date: fmt.datetime(inv.createdAt),
      totalAmount: fmt.money(inv.totalAmount),
      discountAmount: fmt.money(inv.discountAmount),
      taxAmount: fmt.money(inv.taxAmount),
      paymentType: inv.paymentType,
      paymentStatus: inv.paymentStatus,
      itemCount: inv.items.length,
      cashPaid: fmt.money(inv.payments.filter(p => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0)),
      cardPaid: fmt.money(inv.payments.filter(p => p.method === 'CARD').reduce((s, p) => s + Number(p.amount), 0)),
    }));

    const summaryColumns = [
      { key: 'invoiceNo',     header: '№ Чека',            width: 20 },
      { key: 'date',          header: 'Дата и время',      width: 20 },
      { key: 'totalAmount',   header: 'Сумма',             width: 14 },
      { key: 'discountAmount',header: 'Скидка',            width: 12 },
      { key: 'taxAmount',     header: 'Налог',             width: 12 },
      { key: 'paymentType',   header: 'Тип оплаты',        width: 14 },
      { key: 'paymentStatus', header: 'Статус',            width: 14 },
      { key: 'itemCount',     header: 'Позиций',           width: 10 },
      { key: 'cashPaid',      header: 'Наличные',          width: 14 },
      { key: 'cardPaid',      header: 'Карта',             width: 14 },
    ];

    // Sheet 2: Line items
    const itemRows: Record<string, any>[] = [];
    for (const inv of invoices) {
      for (const item of inv.items) {
        itemRows.push({
          invoiceNo: inv.invoiceNo,
          date: fmt.date(inv.createdAt),
          productName: item.product?.name ?? '—',
          sku: item.product?.sku ?? '—',
          quantity: fmt.qty(item.quantity),
          sellingPrice: fmt.money(item.sellingPrice),
          lineTotal: fmt.money(item.lineTotal),
          discount: fmt.money(item.discount),
        });
      }
    }

    const itemColumns = [
      { key: 'invoiceNo',   header: '№ Чека',         width: 20 },
      { key: 'date',        header: 'Дата',            width: 14 },
      { key: 'productName', header: 'Товар',           width: 35 },
      { key: 'sku',         header: 'Артикул',         width: 16 },
      { key: 'quantity',    header: 'Кол-во',          width: 10 },
      { key: 'sellingPrice',header: 'Цена',            width: 12 },
      { key: 'discount',    header: 'Скидка',          width: 10 },
      { key: 'lineTotal',   header: 'Сумма',           width: 12 },
    ];

    const buf = buildXlsxBuffer([
      { name: 'Продажи (сводка)',  rows: summaryRows, columns: summaryColumns },
      { name: 'Продажи (детали)',  rows: itemRows,    columns: itemColumns },
    ]);
    setXlsxHeaders(res, `Продажи_${from ? fmt.date(from) : 'все'}_${to ? fmt.date(to) : ''}`);
    res.send(buf);
  }),
);

// ─── GET /api/export/inventory ─────────────────────────────────────────────
// All batches with expiry dates (for compliance and write-off reports).
exportRouter.get(
  '/inventory',
  authenticate,
  requireRole(['ADMIN', 'OWNER', 'PHARMACIST', 'WAREHOUSE_STAFF']),
  asyncHandler(async (_req, res) => {
    const batches = await prisma.batch.findMany({
      where: { quantity: { gt: 0 } },
      include: {
        product: { select: { name: true, sku: true, barcode: true, sellingPrice: true } },
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    const today = new Date();
    const d30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const d90 = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    const rows = batches.map((b) => {
      const expiry = new Date(b.expiryDate);
      const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      let expiryStatus = 'Норма';
      if (daysLeft <= 0)  expiryStatus = 'ПРОСРОЧЕН';
      else if (expiry <= d30) expiryStatus = 'до 30 дней';
      else if (expiry <= d90) expiryStatus = 'до 90 дней';

      return {
        productName: b.product?.name ?? '—',
        sku: b.product?.sku ?? '—',
        barcode: b.product?.barcode ?? '—',
        batchNumber: b.batchNumber,
        quantity: fmt.qty(b.quantity),
        unit: b.unit ?? 'шт.',
        costBasis: fmt.money(b.costBasis),
        sellingPrice: fmt.money(b.product?.sellingPrice),
        totalCostValue: fmt.money(Number(b.costBasis || 0) * Number(b.quantity || 0)),
        manufacturedDate: fmt.date(b.manufacturedDate),
        expiryDate: fmt.date(b.expiryDate),
        daysLeft,
        expiryStatus,
        supplier: b.supplier?.name ?? '—',
        warehouse: b.warehouse?.name ?? '—',
      };
    });

    const columns = [
      { key: 'productName',    header: 'Наименование',     width: 35 },
      { key: 'sku',            header: 'Артикул',          width: 15 },
      { key: 'barcode',        header: 'Штрихкод',         width: 18 },
      { key: 'batchNumber',    header: 'Партия',           width: 18 },
      { key: 'quantity',       header: 'Остаток',          width: 10 },
      { key: 'unit',           header: 'Ед.',              width: 7  },
      { key: 'costBasis',      header: 'Себестоимость',    width: 15 },
      { key: 'sellingPrice',   header: 'Цена прод.',       width: 13 },
      { key: 'totalCostValue', header: 'Сумма (себест.)',  width: 16 },
      { key: 'manufacturedDate',header: 'Дата произв.',    width: 14 },
      { key: 'expiryDate',     header: 'Срок годности',   width: 14 },
      { key: 'daysLeft',       header: 'Дней осталось',   width: 14 },
      { key: 'expiryStatus',   header: 'Статус срока',    width: 14 },
      { key: 'supplier',       header: 'Поставщик',       width: 22 },
      { key: 'warehouse',      header: 'Склад',           width: 18 },
    ];

    const buf = buildXlsxBuffer([{ name: 'Остатки по партиям', rows, columns }]);
    setXlsxHeaders(res, `Остатки_${fmt.date(new Date())}`);
    res.send(buf);
  }),
);

// ─── GET /api/export/returns ───────────────────────────────────────────────
exportRouter.get(
  '/returns',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const from = parseDate(req.query.from);
    const to   = parseDate(req.query.to);

    const returns = await prisma.return.findMany({
      where: {
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to   ? { lte: to }   : {}),
          },
        } : {}),
      },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows: Record<string, any>[] = [];
    for (const ret of returns) {
      for (const item of ret.items) {
        rows.push({
          returnNo: ret.returnNo,
          date: fmt.datetime(ret.createdAt),
          type: ret.type === 'CUSTOMER' ? 'Покупатель' : 'Поставщик',
          status: ret.status,
          refundMethod: ret.refundMethod ?? '—',
          productName: item.product?.name ?? '—',
          sku: item.product?.sku ?? '—',
          quantity: fmt.qty(item.quantity),
          unitPrice: fmt.money(item.unitPrice),
          lineTotal: fmt.money(item.lineTotal),
          createdBy: ret.createdBy?.name ?? '—',
          approvedBy: ret.approvedBy?.name ?? '—',
        });
      }
    }

    const columns = [
      { key: 'returnNo',    header: '№ Возврата',     width: 22 },
      { key: 'date',        header: 'Дата',           width: 20 },
      { key: 'type',        header: 'Тип',            width: 14 },
      { key: 'status',      header: 'Статус',         width: 14 },
      { key: 'refundMethod',header: 'Метод возврата', width: 16 },
      { key: 'productName', header: 'Товар',          width: 35 },
      { key: 'sku',         header: 'Артикул',        width: 15 },
      { key: 'quantity',    header: 'Кол-во',         width: 10 },
      { key: 'unitPrice',   header: 'Цена',           width: 12 },
      { key: 'lineTotal',   header: 'Сумма',          width: 12 },
      { key: 'createdBy',   header: 'Создал',         width: 18 },
      { key: 'approvedBy',  header: 'Одобрил',        width: 18 },
    ];

    const buf = buildXlsxBuffer([{ name: 'Возвраты', rows, columns }]);
    setXlsxHeaders(res, `Возвраты_${fmt.date(new Date())}`);
    res.send(buf);
  }),
);

// ─── GET /api/export/writeoffs ─────────────────────────────────────────────
exportRouter.get(
  '/writeoffs',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (_req, res) => {
    const writeOffs = await prisma.writeOff.findMany({
      include: {
        items: { include: { product: { select: { name: true, sku: true } }, batch: { select: { batchNumber: true, expiryDate: true } } } },
        createdBy: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows: Record<string, any>[] = [];
    for (const wo of writeOffs) {
      for (const item of wo.items) {
        rows.push({
          date: fmt.datetime(wo.createdAt),
          reason: wo.reason,
          note: wo.note ?? '—',
          warehouse: wo.warehouse?.name ?? '—',
          productName: item.product?.name ?? '—',
          sku: item.product?.sku ?? '—',
          batchNumber: item.batch?.batchNumber ?? '—',
          expiryDate: fmt.date(item.batch?.expiryDate),
          quantity: fmt.qty(item.quantity),
          createdBy: wo.createdBy?.name ?? '—',
        });
      }
    }

    const columns = [
      { key: 'date',        header: 'Дата',           width: 20 },
      { key: 'reason',      header: 'Причина',        width: 18 },
      { key: 'note',        header: 'Примечание',     width: 30 },
      { key: 'warehouse',   header: 'Склад',          width: 18 },
      { key: 'productName', header: 'Товар',          width: 35 },
      { key: 'sku',         header: 'Артикул',        width: 15 },
      { key: 'batchNumber', header: 'Партия',         width: 18 },
      { key: 'expiryDate',  header: 'Срок годн.',     width: 14 },
      { key: 'quantity',    header: 'Кол-во',         width: 10 },
      { key: 'createdBy',   header: 'Сотрудник',      width: 20 },
    ];

    const buf = buildXlsxBuffer([{ name: 'Списания', rows, columns }]);
    setXlsxHeaders(res, `Списания_${fmt.date(new Date())}`);
    res.send(buf);
  }),
);
