
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const from = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = new Date();
  
  console.log('Testing dashboard query range:', from.toISOString(), 'to', to.toISOString());

  try {
    const [salesInvoicesInRange, writeoffsMonth] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          status: { notIn: ['CANCELLED'] },
        },
        select: {
          id: true,
          totalAmount: true,
          items: {
            select: {
               quantity: true,
               batch: { select: { costBasis: true } }
            }
          }
        },
      }),
      prisma.writeOff.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: {
          totalAmount: true,
          items: {
            select: { quantity: true, unitCost: true, lineTotal: true },
          },
        },
      })
    ]);

    console.log('Found invoices:', salesInvoicesInRange.length);
    console.log('Found writeoffs:', writeoffsMonth.length);
    
    const revenue = salesInvoicesInRange.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    console.log('Total revenue:', revenue);

  } catch (err) {
    console.error('DATABASE ERROR:', err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
