import { prisma } from '../infrastructure/prisma';

export const normalizeProductName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

export async function findExistingProductByName(name: string) {
  const normalizedName = normalizeProductName(name || '');
  if (!normalizedName) return null;

  const candidates = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
    },
  });

  const match = candidates.find((candidate) => normalizeProductName(candidate.name) === normalizedName);
  if (!match) return null;

  return prisma.product.findUnique({
    where: { id: match.id },
    include: { batches: true },
  });
}