import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const demoProducts = [
  {
    sku: 'AMX-500',
    barcode: '4607001000011',
    name: 'Amoxicillin 500 mg',
    internationalName: 'Amoxicillin',
    category: 'Antibiotics',
    manufacturer: 'FarmStandart',
    dosage: '500',
    dosageUnit: 'mg',
    form: 'Capsules',
    packageType: 'Box',
    unitsPerPack: 20,
    costPrice: 120,
    wholesalePrice: 165,
    retailPrice: 175,
    quantity: 80,
    prescription: true,
    markingRequired: true,
  },
  {
    sku: 'PAR-500',
    barcode: '4607001000013',
    name: 'Paracetamol 500 mg',
    internationalName: 'Paracetamol',
    category: 'Analgesics',
    manufacturer: 'Ozon',
    dosage: '500',
    dosageUnit: 'mg',
    form: 'Tablets',
    packageType: 'Box',
    unitsPerPack: 10,
    costPrice: 35,
    wholesalePrice: 48,
    retailPrice: 55,
    quantity: 250,
    prescription: false,
    markingRequired: false,
  },
  {
    sku: 'CET-010',
    barcode: '4607001000020',
    name: 'Cetirizine 10 mg',
    internationalName: 'Cetirizine',
    category: 'Antihistamines',
    manufacturer: 'KRKA',
    dosage: '10',
    dosageUnit: 'mg',
    form: 'Tablets',
    packageType: 'Blister',
    unitsPerPack: 10,
    costPrice: 72,
    wholesalePrice: 95,
    retailPrice: 105,
    quantity: 120,
    prescription: false,
    markingRequired: false,
  },
];

const demoCustomers = [
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

async function upsertLookup(modelDelegate, where, createData) {
  const existing = await modelDelegate.findFirst({ where });

  if (existing) {
    return modelDelegate.update({
      where: { id: existing.id },
      data: createData,
    });
  }

  return modelDelegate.create({
    data: createData,
  });
}

async function main() {
  const passwordHash = await bcrypt.hash('dev-password', 10);

  const owner = await prisma.user.upsert({
    where: { email: 'admin@pharmapro.com' },
    update: {
      name: 'Dev Admin',
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      email: 'admin@pharmapro.com',
      username: 'admin',
      password: passwordHash,
      name: 'Dev Admin',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {
      name: 'Main Warehouse',
      isDefault: true,
      isActive: true,
      address: 'Tashkent central warehouse',
      type: 'DISTRIBUTION',
    },
    create: {
      code: 'MAIN',
      name: 'Main Warehouse',
      isDefault: true,
      isActive: true,
      address: 'Tashkent central warehouse',
      type: 'DISTRIBUTION',
    },
  });

  const supplierData = {
    name: 'Demo Supplier',
    contact: '+7 (900) 000-00-00',
    email: 'demo@supplier.local',
    address: 'Moscow, Testovaya, 1',
    contractNumber: 'SUP-2026-01',
    contractDate: new Date('2026-01-15'),
    paymentTermDays: 10,
    isActive: true,
  };

  const existingSupplier = await prisma.supplier.findFirst({
    where: {
      OR: [
        { name: supplierData.name },
        { email: supplierData.email },
      ],
    },
  });

  const supplier = existingSupplier
    ? await prisma.supplier.update({
      where: { id: existingSupplier.id },
      data: supplierData,
    })
    : await prisma.supplier.create({
      data: supplierData,
    });

  const createdProducts = [];

  for (const item of demoProducts) {
    const category = await upsertLookup(prisma.productCategory, { name: item.category }, { name: item.category });
    const manufacturer = await upsertLookup(prisma.manufacturer, { name: item.manufacturer }, { name: item.manufacturer, isActive: true });
    const form = await upsertLookup(prisma.productForm, { name: item.form }, { name: item.form });
    const packageType = await upsertLookup(prisma.packageType, { name: item.packageType }, { name: item.packageType });

    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        barcode: item.barcode,
        internationalName: item.internationalName,
        category: item.category,
        categoryId: category.id,
        manufacturer: item.manufacturer,
        manufacturerId: manufacturer.id,
        dosage: item.dosage,
        dosageUnit: item.dosageUnit,
        formId: form.id,
        packageTypeId: packageType.id,
        unitsPerPack: item.unitsPerPack,
        minStock: 10,
        costPrice: item.costPrice,
        sellingPrice: item.retailPrice,
        isActive: true,
        status: 'ACTIVE',
        prescription: item.prescription,
        markingRequired: item.markingRequired,
      },
      create: {
        sku: item.sku,
        barcode: item.barcode,
        name: item.name,
        internationalName: item.internationalName,
        category: item.category,
        categoryId: category.id,
        manufacturer: item.manufacturer,
        manufacturerId: manufacturer.id,
        dosage: item.dosage,
        dosageUnit: item.dosageUnit,
        formId: form.id,
        packageTypeId: packageType.id,
        unitsPerPack: item.unitsPerPack,
        minStock: 10,
        totalStock: item.quantity,
        costPrice: item.costPrice,
        sellingPrice: item.retailPrice,
        isActive: true,
        status: 'ACTIVE',
        prescription: item.prescription,
        markingRequired: item.markingRequired,
      },
    });

    await prisma.batch.upsert({
      where: { id: `${item.sku}-demo-batch` },
      update: {
        quantity: item.quantity,
        initialQty: item.quantity,
        currentQty: item.quantity,
        availableQty: item.quantity,
        reservedQty: 0,
        costBasis: item.costPrice,
        purchasePrice: item.costPrice,
        wholesalePrice: item.wholesalePrice,
        retailPrice: item.retailPrice,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        receivedAt: new Date('2026-04-01'),
      },
      create: {
        id: `${item.sku}-demo-batch`,
        productId: product.id,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        batchNumber: `${item.sku}-DEMO`,
        quantity: item.quantity,
        initialQty: item.quantity,
        currentQty: item.quantity,
        reservedQty: 0,
        availableQty: item.quantity,
        unit: 'units',
        costBasis: item.costPrice,
        purchasePrice: item.costPrice,
        wholesalePrice: item.wholesalePrice,
        retailPrice: item.retailPrice,
        manufacturedDate: new Date('2026-01-01'),
        receivedAt: new Date('2026-04-01'),
        expiryDate: new Date('2028-12-31'),
        status: 'STABLE',
      },
    });

    await prisma.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
      update: { quantity: item.quantity },
      create: { warehouseId: warehouse.id, productId: product.id, quantity: item.quantity },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { totalStock: item.quantity },
    });

    createdProducts.push({ ...product, ...item });
  }

  for (const customer of demoCustomers) {
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

  const purchaseInvoice = await prisma.purchaseInvoice.upsert({
    where: { invoiceNumber: 'PINV-DEMO-0001' },
    update: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      status: 'POSTED',
      paymentStatus: 'PARTIALLY_PAID',
      totalAmount: createdProducts.reduce((sum, item) => sum + item.costPrice * 50, 0),
      createdById: owner.id,
    },
    create: {
      invoiceNumber: 'PINV-DEMO-0001',
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      invoiceDate: new Date('2026-04-01'),
      status: 'POSTED',
      paymentStatus: 'PARTIALLY_PAID',
      totalAmount: createdProducts.reduce((sum, item) => sum + item.costPrice * 50, 0),
      createdById: owner.id,
    },
  });

  for (const [index, product] of createdProducts.entries()) {
    await prisma.purchaseInvoiceItem.upsert({
      where: { id: `purchase-item-${index + 1}` },
      update: {
        purchaseInvoiceId: purchaseInvoice.id,
        productId: product.id,
        quantity: 50,
        purchasePrice: product.costPrice,
        wholesalePrice: product.wholesalePrice,
        retailPrice: product.retailPrice,
        lineTotal: product.costPrice * 50,
      },
      create: {
        id: `purchase-item-${index + 1}`,
        purchaseInvoiceId: purchaseInvoice.id,
        productId: product.id,
        batchNumber: `${product.sku}-PINV-${index + 1}`,
        manufacturedDate: new Date('2026-01-01'),
        expiryDate: new Date('2028-12-31'),
        quantity: 50,
        purchasePrice: product.costPrice,
        wholesalePrice: product.wholesalePrice,
        retailPrice: product.retailPrice,
        lineTotal: product.costPrice * 50,
      },
    });
  }

  const customer = await prisma.customer.findUnique({ where: { code: 'CUST-001' } });
  if (customer) {
    await prisma.receivable.upsert({
      where: { id: 'demo-receivable-001' },
      update: {
        customerId: customer.id,
        originalAmount: 2500000,
        paidAmount: 500000,
        remainingAmount: 2000000,
        dueDate: new Date('2026-04-20'),
        status: 'PARTIAL',
      },
      create: {
        id: 'demo-receivable-001',
        customerId: customer.id,
        originalAmount: 2500000,
        paidAmount: 500000,
        remainingAmount: 2000000,
        dueDate: new Date('2026-04-20'),
        status: 'PARTIAL',
      },
    });

    await prisma.payment.upsert({
      where: { id: 'demo-payment-in-001' },
      update: {
        direction: 'IN',
        counterpartyType: 'CUSTOMER',
        customerId: customer.id,
        method: 'BANK_TRANSFER',
        amount: 500000,
        paymentDate: new Date('2026-04-06'),
        status: 'PAID',
        referenceNumber: 'PAY-IN-2026-001',
        createdById: owner.id,
        comment: 'Demo customer prepayment for wholesale order',
      },
      create: {
        id: 'demo-payment-in-001',
        direction: 'IN',
        counterpartyType: 'CUSTOMER',
        customerId: customer.id,
        method: 'BANK_TRANSFER',
        amount: 500000,
        paymentDate: new Date('2026-04-06'),
        status: 'PAID',
        referenceNumber: 'PAY-IN-2026-001',
        createdById: owner.id,
        comment: 'Demo customer prepayment for wholesale order',
      },
    });
  }

  await prisma.payable.upsert({
    where: { id: 'demo-payable-001' },
    update: {
      supplierId: supplier.id,
      purchaseInvoiceId: purchaseInvoice.id,
      originalAmount: purchaseInvoice.totalAmount,
      paidAmount: purchaseInvoice.totalAmount / 2,
      remainingAmount: purchaseInvoice.totalAmount / 2,
      dueDate: new Date('2026-04-15'),
      status: 'PARTIAL',
    },
    create: {
      id: 'demo-payable-001',
      supplierId: supplier.id,
      purchaseInvoiceId: purchaseInvoice.id,
      originalAmount: purchaseInvoice.totalAmount,
      paidAmount: purchaseInvoice.totalAmount / 2,
      remainingAmount: purchaseInvoice.totalAmount / 2,
      dueDate: new Date('2026-04-15'),
      status: 'PARTIAL',
    },
  });

  await prisma.payment.upsert({
    where: { id: 'demo-payment-out-001' },
    update: {
      direction: 'OUT',
      counterpartyType: 'SUPPLIER',
      supplierId: supplier.id,
      purchaseInvoiceId: purchaseInvoice.id,
      method: 'BANK_TRANSFER',
      amount: purchaseInvoice.totalAmount / 2,
      paymentDate: new Date('2026-04-06'),
      status: 'PAID',
      referenceNumber: 'PAY-OUT-2026-001',
      createdById: owner.id,
      comment: 'Demo supplier partial payment',
    },
    create: {
      id: 'demo-payment-out-001',
      direction: 'OUT',
      counterpartyType: 'SUPPLIER',
      supplierId: supplier.id,
      purchaseInvoiceId: purchaseInvoice.id,
      method: 'BANK_TRANSFER',
      amount: purchaseInvoice.totalAmount / 2,
      paymentDate: new Date('2026-04-06'),
      status: 'PAID',
      referenceNumber: 'PAY-OUT-2026-001',
      createdById: owner.id,
      comment: 'Demo supplier partial payment',
    },
  });

  console.log(JSON.stringify({
    ok: true,
    userEmail: owner.email,
    warehouseCode: warehouse.code,
    supplierId: supplier.id,
    products: createdProducts.length,
    customers: demoCustomers.length,
    purchaseInvoice: purchaseInvoice.invoiceNumber,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
