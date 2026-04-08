export const computeProductStatus = (
  totalStock: number,
  minStock: number,
): 'ACTIVE' | 'LOW_STOCK' | 'OUT_OF_STOCK' => {
  if (totalStock <= 0) return 'OUT_OF_STOCK';
  if (totalStock < minStock) return 'LOW_STOCK';
  return 'ACTIVE';
};
