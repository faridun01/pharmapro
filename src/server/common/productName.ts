import { prisma } from '../infrastructure/prisma';

export const normalizeProductName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
const normalizeCountry = (value: string | null | undefined) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

export async function findExistingProductByName(
  name: string, 
  countryOfOrigin?: string | null,
  dosage?: string | null,
  formId?: string | null
) {
  const normalizedName = normalizeProductName(name || '');
  if (!normalizedName) return null;

  const matched = await prisma.product.findFirst({
    where: {
      isActive: true,
      name: {
        equals: normalizedName,
        mode: 'insensitive',
      },
      ...(dosage ? { dosage: { equals: dosage.trim(), mode: 'insensitive' } } : {}),
      ...(formId ? { formId: formId } : {}),
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