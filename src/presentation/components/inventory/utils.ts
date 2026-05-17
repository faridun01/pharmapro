export const generateSku = (name: string): string => {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);
  const timePart = Date.now().toString().slice(-6);
  const randomPart = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${base || 'ITEM'}-${timePart}-${randomPart}`;
};

export const generateBatchNumber = (sku: string): string => {
  if (!sku.trim()) return '';
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const skuPrefix = sku.split('-')[0]?.substring(0, 3)?.toUpperCase() || 'BAT';
  const randomId = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `#${skuPrefix}-${dateStr}-${randomId}`;
};

export const getBatchHistoryStatusLabel = (status: string, expiryDate: string | Date) => {
  const isExpired = new Date(expiryDate).getTime() < Date.now();
  if (isExpired) return 'Истёк';
  if (status === 'STABLE') return 'В норме';
  if (status === 'NEAR_EXPIRY') return 'Срок скоро истекает';
  if (status === 'EXPIRED') return 'Просрочено';
  if (status === 'DAMAGED') return 'Повреждено';
  return status;
};
