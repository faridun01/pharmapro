export const computeBatchStatus = (expiryDate: Date | string | null | undefined): 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED' => {
  if (!expiryDate) return 'STABLE';

  const parsed = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(parsed.getTime())) return 'STABLE';

  const diffDays = Math.ceil((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'EXPIRED';
  if (diffDays <= 30) return 'CRITICAL';
  if (diffDays <= 90) return 'NEAR_EXPIRY';
  return 'STABLE';
};
