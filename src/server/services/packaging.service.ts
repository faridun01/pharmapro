import { prisma } from '../infrastructure/prisma';

const deriveUnitsPerPack = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return 5 + (hash % 26);
};

export const ensureProductPackagingBackfill = async () => {
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { unitsPerPack: null },
        { unitsPerPack: { lt: 2 } },
      ],
    },
    select: {
      id: true,
      sku: true,
      name: true,
    },
  });

  if (products.length === 0) {
    return { updated: 0 };
  }

  await prisma.$transaction(
    products.map((product) =>
      prisma.product.update({
        where: { id: product.id },
        data: {
          unitsPerPack: deriveUnitsPerPack(product.sku || product.id || product.name || 'default'),
        },
      }),
    ),
  );

  return { updated: products.length };
};