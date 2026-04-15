
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.invoice.count();
  console.log('Total invoices:', count);

  const latest = await prisma.invoice.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { id: true, invoiceNo: true, createdAt: true, status: true, totalAmount: true }
  });
  console.log('Latest 5 invoices:', JSON.stringify(latest, null, 2));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  console.log('Searching for invoices gte:', monthStart.toISOString());

  const thisMonth = await prisma.invoice.count({
    where: { createdAt: { gte: monthStart } }
  });
  console.log('Invoices this month:', thisMonth);

  const writeoffs = await prisma.writeOff.count({
    where: { createdAt: { gte: monthStart } }
  });
  console.log('Writeoffs this month:', writeoffs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
