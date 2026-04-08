export type ShiftCloseNotice = {
  shiftId: string;
  shiftNo?: string;
  grossProfit: number;
  finalAmount: number;
  netSales: number;
  closedAt: string;
};

const STORAGE_KEY = 'pharmapro_last_closed_shift_notice';
const EVENT_NAME = 'pharmapro:shift-closed';

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const getShiftClosedEventName = () => EVENT_NAME;

export const loadLatestClosedShiftNotice = (): ShiftCloseNotice | null => {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ShiftCloseNotice;
  } catch {
    return null;
  }
};

export const saveLatestClosedShiftNotice = (notice: Omit<ShiftCloseNotice, 'closedAt'> & { closedAt?: string }) => {
  if (!canUseStorage()) return;

  const nextNotice: ShiftCloseNotice = {
    ...notice,
    closedAt: notice.closedAt || new Date().toISOString(),
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextNotice));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: nextNotice }));
};