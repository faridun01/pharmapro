import { prisma } from '../infrastructure/prisma';

export const normalizeProductName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
const normalizeCountry = (value: string | null | undefined) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

export async function findExistingProductByName(name: string, countryOfOrigin?: string | null) {
  const normalizedName = normalizeProductName(name || '');
  if (!normalizedName) return null;

  // Search by name directly in DB (case-insensitive)
  // We first fetch active products with exact case-insensitive name match.
  // This is much faster than loading all products into memory.
  const matched = await prisma.product.findFirst({
    where: {
      isActive: true,
      name: {
        equals: normalizedName,
        mode: 'insensitive',
      },
      // If country is provided, match it too (case-insensitive)
      ...(countryOfOrigin
        ? {
            countryOfOrigin: {
              equals: countryOfOrigin.trim(),
              mode: 'insensitive',
            },
          }
        : {
            OR: [
              { countryOfOrigin: null },
              { countryOfOrigin: '' },
            ],
          }),
    },
    include: {
      batches: {
        where: { quantity: { gt: 0 } },
      },
    },
  });

  return matched;
}