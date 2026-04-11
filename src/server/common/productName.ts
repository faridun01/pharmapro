import { prisma } from '../infrastructure/prisma';

export const normalizeProductName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
const normalizeCountry = (value: string | null | undefined) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

export async function findExistingProductByName(name: string, countryOfOrigin?: string | null) {
  const normalizedName = normalizeProductName(name || '');
  if (!normalizedName) return null;
  const normalizedCountry = normalizeCountry(countryOfOrigin);

  const candidates = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      countryOfOrigin: true,
    },
  });

  const match = candidates.find((candidate) => {
    if (normalizeProductName(candidate.name) !== normalizedName) {
      return false;
    }

    const candidateCountry = normalizeCountry(candidate.countryOfOrigin);
    if (normalizedCountry) {
      return candidateCountry === normalizedCountry;
    }

    return !candidateCountry;
  });
  if (!match) return null;

  return prisma.product.findUnique({
    where: { id: match.id },
    include: { batches: true },
  });
}