import { PrismaClient } from '@prisma/client';
import { reportService } from './src/server/modules/reports/report.service.ts';

const prisma = new PrismaClient();

async function run() {
  try {
    const result = await reportService.getFinanceReport({ preset: 'month' });
    console.log("SUCCESS:", Object.keys(result));
  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
