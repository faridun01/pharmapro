import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';

export const devRouter = Router();

const buildStockIntegrityReport = async () => {
  const [products, warehouseStocks] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        batches: {
          where: {},
          select: {
            id: true,
            batchNumber: true,
            quantity: true,
            currentQty: true,
            availableQty: true,
            reservedQty: true,
            warehouseId: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouseStock.findMany({
      select: {
        warehouseId: true,
        productId: true,
        quantity: true,
      },
    }),
  ]);

  const issues: Array<Record<string, any>> = [];

  for (const product of products) {
    let batchQtySum = 0;
    let batchCurrentSum = 0;
    let batchAvailableSum = 0;
    let batchReservedSum = 0;

    for (const batch of product.batches) {
      const qty = Number(batch.quantity || 0);
      const current = Number(batch.currentQty || 0);
      const available = Number(batch.availableQty || 0);
      const reserved = Number(batch.reservedQty || 0);

      batchQtySum += qty;
      batchCurrentSum += current;
      batchAvailableSum += available;
      batchReservedSum += reserved;

      if (current !== available + reserved) {
        issues.push({
          type: 'BATCH_MISMATCH',
          productId: product.id,
          productName: product.name,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          currentQty: current,
          availableQty: available,
          reservedQty: reserved,
          message: 'currentQty must equal availableQty + reservedQty',
        });
      }

      if (qty !== current) {
        issues.push({
          type: 'BATCH_QTY_MISMATCH',
          productId: product.id,
          productName: product.name,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantity: qty,
          currentQty: current,
          message: 'quantity must equal currentQty for active inventory model',
        });
      }
    }

    const relatedStocks = warehouseStocks.filter((s) => s.productId === product.id);
    const warehouseStockSum = relatedStocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0);

    if (Number(product.totalStock || 0) !== batchQtySum) {
      issues.push({
        type: 'PRODUCT_TOTAL_MISMATCH',
        productId: product.id,
        productName: product.name,
        productTotalStock: Number(product.totalStock || 0),
        batchQtySum,
        message: 'product.totalStock must equal sum(batch.quantity)',
      });
    }

    if (warehouseStockSum !== batchQtySum) {
      issues.push({
        type: 'WAREHOUSE_STOCK_MISMATCH',
        productId: product.id,
        productName: product.name,
        batchQtySum,
        warehouseStockSum,
        message: 'sum(warehouse_stock) must equal sum(batch.quantity)',
      });
    }

    if (batchCurrentSum !== batchAvailableSum + batchReservedSum) {
      issues.push({
        type: 'PRODUCT_BATCH_FIELDS_MISMATCH',
        productId: product.id,
        productName: product.name,
        batchCurrentSum,
        batchAvailableSum,
        batchReservedSum,
        message: 'sum(currentQty) must equal sum(availableQty) + sum(reservedQty)',
      });
    }
  }

  return {
    checkedProducts: products.length,
    checkedWarehouseStockRows: warehouseStocks.length,
    issuesCount: issues.length,
    issues,
  };
};

const applyStockIntegrityFix = async () => {
  const [products, warehouseStocks, warehouses] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        batches: {
          select: {
            id: true,
            quantity: true,
            currentQty: true,
            availableQty: true,
            reservedQty: true,
            warehouseId: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouseStock.findMany({
      select: {
        warehouseId: true,
        productId: true,
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Promise.resolve([] as never[]),
  ]);

  await prisma.$transaction(async (tx) => {
    for (const product of products) {
      let batchQtySum = 0;
      // Group batch quantities per warehouse to preserve multi-warehouse distribution
      const warehouseQtyMap = new Map<string, number>();

      for (const batch of product.batches) {
        const qty = Math.max(0, Number(batch.quantity || 0));
        const reserved = Math.max(0, Number(batch.reservedQty || 0));
        const targetReserved = Math.min(reserved, qty);
        const targetCurrent = qty;
        const targetAvailable = Math.max(0, qty - targetReserved);

        batchQtySum += qty;

        if (batch.warehouseId) {
          warehouseQtyMap.set(
            batch.warehouseId,
            (warehouseQtyMap.get(batch.warehouseId) ?? 0) + qty,
          );
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: {
            quantity: qty,
            currentQty: targetCurrent,
            reservedQty: targetReserved,
            availableQty: targetAvailable,
          },
        });
      }

      await tx.product.update({
        where: { id: product.id },
        data: { totalStock: batchQtySum },
      });

      // Sync each warehouse stock row to match its own batches — no cross-warehouse redistribution
      for (const [warehouseId, qty] of warehouseQtyMap.entries()) {
        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId, productId: product.id } },
          update: { quantity: qty },
          create: { warehouseId, productId: product.id, quantity: qty },
        });
      }

      // Zero out stale warehouse rows that no longer have any batches assigned
      const activeWarehouseIds = new Set(warehouseQtyMap.keys());
      const staleRows = warehouseStocks.filter(
        (row) => row.productId === product.id && !activeWarehouseIds.has(row.warehouseId),
      );
      for (const stale of staleRows) {
        await tx.warehouseStock.updateMany({
          where: { warehouseId: stale.warehouseId, productId: product.id },
          data: { quantity: 0 },
        });
      }
    }
  });
};

type DemoProduct = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  manufacturer: string;
  costPrice: number;
  sellingPrice: number;
  prescription: boolean;
  markingRequired: boolean;
  quantity: number;
};

const DEMO_PRODUCTS: DemoProduct[] = [
  { name: 'Амоксициллин 500 мг', sku: 'AMX-500', barcode: '4607001000011', category: 'Антибиотики', manufacturer: 'ФармСтандарт', costPrice: 120, sellingPrice: 175, prescription: true, markingRequired: true, quantity: 80 },
  { name: 'Азитромицин 250 мг', sku: 'AZM-250', barcode: '4607001000012', category: 'Антибиотики', manufacturer: 'Вертекс', costPrice: 150, sellingPrice: 220, prescription: true, markingRequired: true, quantity: 70 },
  { name: 'Парацетамол 500 мг', sku: 'PAR-500', barcode: '4607001000013', category: 'Обезболивающие', manufacturer: 'Озон', costPrice: 35, sellingPrice: 55, prescription: false, markingRequired: false, quantity: 250 },
  { name: 'Ибупрофен 400 мг', sku: 'IBU-400', barcode: '4607001000014', category: 'Обезболивающие', manufacturer: 'Биохимик', costPrice: 48, sellingPrice: 75, prescription: false, markingRequired: false, quantity: 180 },
  { name: 'Нурофен 200 мг', sku: 'NUR-200', barcode: '4607001000015', category: 'Обезболивающие', manufacturer: 'Reckitt', costPrice: 95, sellingPrice: 145, prescription: false, markingRequired: false, quantity: 110 },
  { name: 'Витамин C 1000 мг', sku: 'VITC-1000', barcode: '4607001000016', category: 'Витамины', manufacturer: 'Эвалар', costPrice: 85, sellingPrice: 130, prescription: false, markingRequired: false, quantity: 140 },
  { name: 'Витамин D3 2000 ME', sku: 'VITD-2000', barcode: '4607001000017', category: 'Витамины', manufacturer: 'Solgar', costPrice: 210, sellingPrice: 320, prescription: false, markingRequired: false, quantity: 90 },
  { name: 'Магний B6', sku: 'MGB6-001', barcode: '4607001000018', category: 'Витамины', manufacturer: 'Sanofi', costPrice: 160, sellingPrice: 240, prescription: false, markingRequired: false, quantity: 100 },
  { name: 'Лоратадин 10 мг', sku: 'LOR-010', barcode: '4607001000019', category: 'Антигистаминные', manufacturer: 'Тева', costPrice: 60, sellingPrice: 95, prescription: false, markingRequired: false, quantity: 130 },
  { name: 'Цетиризин 10 мг', sku: 'CET-010', barcode: '4607001000020', category: 'Антигистаминные', manufacturer: 'KRKA', costPrice: 72, sellingPrice: 105, prescription: false, markingRequired: false, quantity: 120 },
  { name: 'Омепразол 20 мг', sku: 'OME-020', barcode: '4607001000021', category: 'ЖКТ', manufacturer: 'Sandoz', costPrice: 68, sellingPrice: 102, prescription: false, markingRequired: false, quantity: 115 },
  { name: 'Смекта 3 г', sku: 'SME-003', barcode: '4607001000022', category: 'ЖКТ', manufacturer: 'Ipsen', costPrice: 105, sellingPrice: 155, prescription: false, markingRequired: false, quantity: 95 },
  { name: 'Регидрон', sku: 'REG-001', barcode: '4607001000023', category: 'ЖКТ', manufacturer: 'Орион', costPrice: 42, sellingPrice: 68, prescription: false, markingRequired: false, quantity: 160 },
  { name: 'Хлоргексидин 0.05%', sku: 'CHG-005', barcode: '4607001000024', category: 'Антисептики', manufacturer: 'Росбио', costPrice: 22, sellingPrice: 39, prescription: false, markingRequired: false, quantity: 220 },
  { name: 'Перекись водорода 3%', sku: 'H2O2-003', barcode: '4607001000025', category: 'Антисептики', manufacturer: 'Йодные технологии', costPrice: 18, sellingPrice: 32, prescription: false, markingRequired: false, quantity: 200 },
  { name: 'Бинт стерильный 5x10', sku: 'BINT-510', barcode: '4607001000026', category: 'Перевязка', manufacturer: 'МедТекс', costPrice: 14, sellingPrice: 26, prescription: false, markingRequired: false, quantity: 260 },
  { name: 'Пластырь бактерицидный', sku: 'PLAST-001', barcode: '4607001000027', category: 'Перевязка', manufacturer: 'Hartmann', costPrice: 20, sellingPrice: 36, prescription: false, markingRequired: false, quantity: 240 },
  { name: 'Терафлю', sku: 'THERA-001', barcode: '4607001000028', category: 'Противопростудные', manufacturer: 'GSK', costPrice: 160, sellingPrice: 245, prescription: false, markingRequired: false, quantity: 85 },
  { name: 'Називин спрей', sku: 'NAZ-001', barcode: '4607001000029', category: 'ЛОР', manufacturer: 'Merck', costPrice: 130, sellingPrice: 195, prescription: false, markingRequired: false, quantity: 100 },
  { name: 'Аква Марис', sku: 'AQM-001', barcode: '4607001000030', category: 'ЛОР', manufacturer: 'JGL', costPrice: 175, sellingPrice: 260, prescription: false, markingRequired: false, quantity: 75 },
  { name: 'Ксилометазолин 0.1%', sku: 'KSM-001', barcode: '4607001000031', category: 'ЛОР', manufacturer: 'Renewal', costPrice: 44, sellingPrice: 72, prescription: false, markingRequired: false, quantity: 135 },
  { name: 'Мирамистин 150 мл', sku: 'MIR-150', barcode: '4607001000032', category: 'Антисептики', manufacturer: 'Инфамед', costPrice: 280, sellingPrice: 390, prescription: false, markingRequired: false, quantity: 60 },
  { name: 'Но-шпа 40 мг', sku: 'NOS-040', barcode: '4607001000033', category: 'Спазмолитики', manufacturer: 'Sanofi', costPrice: 145, sellingPrice: 210, prescription: false, markingRequired: false, quantity: 90 },
  { name: 'Дротаверин 40 мг', sku: 'DRT-040', barcode: '4607001000034', category: 'Спазмолитики', manufacturer: 'Озон', costPrice: 62, sellingPrice: 98, prescription: false, markingRequired: false, quantity: 120 },
  { name: 'Лизобакт', sku: 'LIZ-001', barcode: '4607001000035', category: 'ЛОР', manufacturer: 'Bosnalijek', costPrice: 220, sellingPrice: 315, prescription: false, markingRequired: false, quantity: 70 },
  { name: 'Амброксол 30 мг', sku: 'AMB-030', barcode: '4607001000036', category: 'Противопростудные', manufacturer: 'Sandoz', costPrice: 58, sellingPrice: 92, prescription: false, markingRequired: false, quantity: 110 },
  { name: 'АЦЦ 200', sku: 'ACC-200', barcode: '4607001000037', category: 'Противопростудные', manufacturer: 'Hexal', costPrice: 180, sellingPrice: 268, prescription: false, markingRequired: false, quantity: 80 },
  { name: 'Левофлоксацин 500 мг', sku: 'LEV-500', barcode: '4607001000038', category: 'Антибиотики', manufacturer: 'Teva', costPrice: 210, sellingPrice: 305, prescription: true, markingRequired: true, quantity: 55 },
  { name: 'Цефтриаксон 1 г', sku: 'CEF-001', barcode: '4607001000039', category: 'Антибиотики', manufacturer: 'Биосинтез', costPrice: 45, sellingPrice: 78, prescription: true, markingRequired: true, quantity: 95 },
  { name: 'Эналаприл 10 мг', sku: 'ENA-010', barcode: '4607001000040', category: 'Кардиология', manufacturer: 'KRKA', costPrice: 70, sellingPrice: 112, prescription: true, markingRequired: false, quantity: 100 },
  { name: 'Лозартан 50 мг', sku: 'LOZ-050', barcode: '4607001000041', category: 'Кардиология', manufacturer: 'Teva', costPrice: 95, sellingPrice: 145, prescription: true, markingRequired: false, quantity: 85 },
  { name: 'Бисопролол 5 мг', sku: 'BIS-005', barcode: '4607001000042', category: 'Кардиология', manufacturer: 'Вертекс', costPrice: 88, sellingPrice: 132, prescription: true, markingRequired: false, quantity: 88 },
  { name: 'Аспирин Кардио 100 мг', sku: 'ASP-100', barcode: '4607001000043', category: 'Кардиология', manufacturer: 'Bayer', costPrice: 165, sellingPrice: 245, prescription: false, markingRequired: false, quantity: 76 },
  { name: 'Метформин 850 мг', sku: 'MET-850', barcode: '4607001000044', category: 'Эндокринология', manufacturer: 'Gedeon', costPrice: 130, sellingPrice: 195, prescription: true, markingRequired: false, quantity: 92 },
  { name: 'Глюкометр тест-полоски', sku: 'GLU-STR', barcode: '4607001000045', category: 'Диабет', manufacturer: 'Accu-Chek', costPrice: 560, sellingPrice: 780, prescription: false, markingRequired: false, quantity: 40 },
  { name: 'Омега-3 1000 мг', sku: 'OMG-1000', barcode: '4607001000046', category: 'Витамины', manufacturer: 'Solgar', costPrice: 420, sellingPrice: 590, prescription: false, markingRequired: false, quantity: 50 },
  { name: 'Цинк 25 мг', sku: 'ZNK-025', barcode: '4607001000047', category: 'Витамины', manufacturer: 'Эвалар', costPrice: 98, sellingPrice: 148, prescription: false, markingRequired: false, quantity: 75 },
  { name: 'Пантенол спрей', sku: 'PAN-001', barcode: '4607001000048', category: 'Дерматология', manufacturer: 'Librederm', costPrice: 210, sellingPrice: 305, prescription: false, markingRequired: false, quantity: 68 },
  { name: 'Клотримазол крем', sku: 'KLT-001', barcode: '4607001000049', category: 'Дерматология', manufacturer: 'Glenmark', costPrice: 84, sellingPrice: 128, prescription: false, markingRequired: false, quantity: 95 },
  { name: 'Левомеколь мазь', sku: 'LEV-MAZ', barcode: '4607001000050', category: 'Дерматология', manufacturer: 'Нижфарм', costPrice: 102, sellingPrice: 152, prescription: false, markingRequired: false, quantity: 83 },
];

async function ensureDefaultWarehouse() {
  let warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: { code: 'MAIN', name: 'Main Warehouse', isDefault: true, isActive: true },
    });
  }
  return warehouse;
}

const DEMO_CUSTOMERS = [
  {
    code: 'CUST-001',
    name: 'City General Pharmacy',
    legalName: 'City General Pharmacy LLC',
    phone: '+998901111111',
    email: 'buyer1@citypharm.local',
    address: 'Tashkent, Yunusabad district',
    managerName: 'Dilshod Karimov',
    creditLimit: 15000000,
    defaultDiscount: 5,
    paymentTermDays: 14,
  },
  {
    code: 'CUST-002',
    name: 'HealthPlus Clinic',
    legalName: 'HealthPlus Clinic LLC',
    phone: '+998902222222',
    email: 'procurement@healthplus.local',
    address: 'Tashkent, Chilanzar district',
    managerName: 'Malika Rakhimova',
    creditLimit: 8000000,
    defaultDiscount: 3,
    paymentTermDays: 7,
  },
];

devRouter.post('/seed-demo', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const warehouse = await ensureDefaultWarehouse();

  const user = await prisma.user.findUnique({ where: { id: authedReq.user.id } })
    ?? await prisma.user.findFirst({ where: { email: authedReq.user.email } })
    ?? await prisma.user.create({
      data: {
        email: authedReq.user.email,
        password: 'dev-password',
        name: 'Dev Admin',
        role: 'ADMIN',
      },
    });

  let supplier = await prisma.supplier.findFirst({ where: { name: 'Demo Supplier' } });
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name: 'Demo Supplier',
        contact: '+7 (900) 000-00-00',
        email: 'demo@supplier.local',
        address: 'Москва, Тестовая, 1',
      },
    });
  }

  let created = 0;
  let updated = 0;

  for (const customer of DEMO_CUSTOMERS) {
    await prisma.customer.upsert({
      where: { code: customer.code },
      update: {
        name: customer.name,
        legalName: customer.legalName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        managerName: customer.managerName,
        creditLimit: customer.creditLimit,
        defaultDiscount: customer.defaultDiscount,
        paymentTermDays: customer.paymentTermDays,
        isActive: true,
      },
      create: {
        code: customer.code,
        name: customer.name,
        legalName: customer.legalName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        managerName: customer.managerName,
        creditLimit: customer.creditLimit,
        defaultDiscount: customer.defaultDiscount,
        paymentTermDays: customer.paymentTermDays,
        isActive: true,
      },
    });
  }

  for (const item of DEMO_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        category: item.category,
        manufacturer: item.manufacturer,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        prescription: item.prescription,
        markingRequired: item.markingRequired,
        status: 'ACTIVE',
      },
      create: {
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        category: item.category,
        manufacturer: item.manufacturer,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        prescription: item.prescription,
        markingRequired: item.markingRequired,
        status: 'ACTIVE',
      },
    });

    const existingBatch = await prisma.batch.findFirst({
      where: {
        productId: product.id,
        batchNumber: `${item.sku}-DEMO`,
      },
    });

    if (!existingBatch) {
      await prisma.batch.create({
        data: {
          productId: product.id,
          batchNumber: `${item.sku}-DEMO`,
          quantity: item.quantity,
          initialQty: item.quantity,
          currentQty: item.quantity,
          availableQty: item.quantity,
          unit: 'units',
          costBasis: item.costPrice,
          purchasePrice: item.costPrice,
          wholesalePrice: Number((item.sellingPrice * 0.92).toFixed(2)),
          retailPrice: item.sellingPrice,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          manufacturedDate: new Date('2026-01-01'),
          receivedAt: new Date('2026-04-01'),
          expiryDate: new Date('2028-12-31'),
          status: 'STABLE',
          movements: {
            create: {
              type: 'RESTOCK',
              quantity: item.quantity,
              description: 'Demo seed stock',
              userId: user.id,
            },
          },
        },
      });
      created += 1;
    } else {
      updated += 1;
    }

    const stock = await prisma.batch.aggregate({
      where: { productId: product.id },
      _sum: { quantity: true },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: {
        totalStock: stock._sum.quantity ?? 0,
        status: (stock._sum.quantity ?? 0) > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
      },
    });

    await prisma.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
      update: { quantity: stock._sum.quantity ?? 0 },
      create: {
        warehouseId: warehouse.id,
        productId: product.id,
        quantity: stock._sum.quantity ?? 0,
      },
    });
  }

  const purchaseExists = await prisma.purchaseInvoice.findFirst({
    where: { invoiceNumber: 'PINV-DEMO-0001' },
    select: { id: true },
  });

  if (!purchaseExists) {
    const sampleProducts = await prisma.product.findMany({
      take: 3,
      orderBy: { name: 'asc' },
      select: { id: true, sku: true, costPrice: true, sellingPrice: true },
    });

    if (sampleProducts.length > 0) {
      await prisma.purchaseInvoice.create({
        data: {
          invoiceNumber: 'PINV-DEMO-0001',
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          invoiceDate: new Date('2026-04-01'),
          status: 'POSTED',
          paymentStatus: 'PARTIALLY_PAID',
          totalAmount: sampleProducts.reduce((sum, product) => sum + product.costPrice * 50, 0),
          createdById: user.id,
          comment: 'Demo purchase invoice',
          items: {
            create: sampleProducts.map((product, index) => ({
              productId: product.id,
              batchNumber: `${product.sku}-PINV-${index + 1}`,
              manufacturedDate: new Date('2026-01-01'),
              expiryDate: new Date('2028-12-31'),
              quantity: 50,
              purchasePrice: product.costPrice,
              wholesalePrice: Number((product.sellingPrice * 0.92).toFixed(2)),
              retailPrice: product.sellingPrice,
              lineTotal: product.costPrice * 50,
            })),
          },
        },
      });
    }
  }

  const cityCustomer = await prisma.customer.findUnique({
    where: { code: 'CUST-001' },
    select: { id: true },
  });

  if (cityCustomer) {
    const receivableExists = await prisma.receivable.findFirst({
      where: { customerId: cityCustomer.id },
      select: { id: true },
    });

    if (!receivableExists) {
      await prisma.receivable.create({
        data: {
          customerId: cityCustomer.id,
          originalAmount: 2500000,
          paidAmount: 500000,
          remainingAmount: 2000000,
          dueDate: new Date('2026-04-20'),
          status: 'PARTIAL',
        },
      });
    }
  }

  res.json({
    ok: true,
    supplierId: supplier.id,
    customersSeeded: DEMO_CUSTOMERS.length,
    createdBatches: created,
    existingBatches: updated,
    productsCount: DEMO_PRODUCTS.length,
  });
}));

devRouter.post('/reset-operations', authenticate, asyncHandler(async (_req, res) => {
  // Reset operational data used by reports, keep catalog/suppliers intact.
  await prisma.$transaction(async (tx) => {
    await tx.cashMovement.deleteMany();
    await tx.invoiceItem.deleteMany();
    await tx.invoice.deleteMany();
    await tx.returnItem.deleteMany();
    await tx.return.deleteMany();
    await tx.writeOffItem.deleteMany();
    await tx.writeOff.deleteMany();
    await tx.cashShift.deleteMany();
    await tx.batchMovement.deleteMany({ where: { description: { contains: 'Write-off #' } } });
  });

  res.json({ ok: true });
}));

devRouter.get('/stock-integrity', authenticate, asyncHandler(async (_req, res) => {
  const report = await buildStockIntegrityReport();
  res.json({ ok: report.issuesCount === 0, ...report });
}));

devRouter.post('/stock-integrity/fix', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const canFix = authedReq.user.role === 'ADMIN' || authedReq.user.role === 'OWNER';
  if (!canFix) {
    return res.status(403).json({ error: 'Only ADMIN/OWNER can run stock repair' });
  }

  await applyStockIntegrityFix();
  const report = await buildStockIntegrityReport();
  res.json({ ok: report.issuesCount === 0, repaired: true, ...report });
}));
