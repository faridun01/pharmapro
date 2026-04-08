import path from 'path';
import { promises as fs } from 'fs';

export type UiLanguage = 'ru';
export type UiTheme = 'light' | 'dark';

export type UserSettingsPreferences = {
  localization: {
    language: UiLanguage;
    timezone: string;
    dateFormat: 'ru-RU';
  };
  currency: {
    code: string;
    symbol: string;
    taxRate: number;
  };
  notifications: {
    lowStockAlerts: boolean;
    expiryAlerts: boolean;
    dailySummary: boolean;
    soundEnabled: boolean;
    lowStockThreshold: number;
    expiryThresholdDays: number;
  };
  appearance: {
    theme: UiTheme;
  };
};

type SystemSettingsState = {
  userPreferences: Record<string, UserSettingsPreferences>;
};

const storageDir = path.join(process.cwd(), 'data');
const storagePath = path.join(storageDir, 'system-settings.json');

const defaultUserPreferences: UserSettingsPreferences = {
  localization: {
    language: 'ru',
    timezone: 'Asia/Dushanbe',
    dateFormat: 'ru-RU',
  },
  currency: {
    code: 'TJS',
    symbol: 'сомонӣ',
    taxRate: 15,
  },
  notifications: {
    lowStockAlerts: true,
    expiryAlerts: true,
    dailySummary: false,
    soundEnabled: true,
    lowStockThreshold: 10,
    expiryThresholdDays: 60,
  },
  appearance: {
    theme: 'light',
  },
};

const defaultState: SystemSettingsState = {
  userPreferences: {},
};

const toInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const toTax = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
};

const toLanguage = (_value: unknown): UiLanguage => 'ru';

const toDateFormat = (_value: unknown): 'ru-RU' => 'ru-RU';

const toTheme = (value: unknown): UiTheme => (value === 'dark' ? 'dark' : 'light');

const toTimezone = (value: unknown, fallback: string) => {
  const zone = toStringSafe(value, fallback, 80);
  return zone === 'Asia/Tashkent' ? 'Asia/Dushanbe' : zone;
};

const toCurrencyCode = (value: unknown, fallback: string) => {
  const code = toStringSafe(value, fallback, 6).toUpperCase();
  return code === 'UZS' ? 'TJS' : code;
};

const toCurrencySymbol = (value: unknown, fallback: string) => {
  const symbol = toStringSafe(value, fallback, 8);
  return symbol === "so'm" ? 'сомонӣ' : symbol;
};

const toStringSafe = (value: unknown, fallback: string, max = 64) => {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.slice(0, max);
};

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
  try {
    await fs.access(storagePath);
  } catch {
    await fs.writeFile(storagePath, JSON.stringify(defaultState, null, 2), 'utf8');
  }
}

export async function readSystemSettings() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(storagePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SystemSettingsState>;
    return {
      userPreferences: parsed.userPreferences || {},
    } satisfies SystemSettingsState;
  } catch {
    return { ...defaultState };
  }
}

export async function writeSystemSettings(state: SystemSettingsState) {
  await ensureStorage();
  await fs.writeFile(storagePath, JSON.stringify(state, null, 2), 'utf8');
}

export function normalizeUserPreferences(input: unknown, current?: UserSettingsPreferences): UserSettingsPreferences {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const base = current || defaultUserPreferences;

  const localization = source.localization && typeof source.localization === 'object' ? source.localization : {};
  const currency = source.currency && typeof source.currency === 'object' ? source.currency : {};
  const notifications = source.notifications && typeof source.notifications === 'object' ? source.notifications : {};
  const appearance = source.appearance && typeof source.appearance === 'object' ? source.appearance : {};

  return {
    localization: {
      language: toLanguage(localization.language ?? base.localization.language),
      timezone: toTimezone(localization.timezone, base.localization.timezone),
      dateFormat: toDateFormat(localization.dateFormat ?? base.localization.dateFormat),
    },
    currency: {
      code: toCurrencyCode(currency.code, base.currency.code),
      symbol: toCurrencySymbol(currency.symbol, base.currency.symbol),
      taxRate: toTax(currency.taxRate, base.currency.taxRate),
    },
    notifications: {
      lowStockAlerts: Boolean(notifications.lowStockAlerts ?? base.notifications.lowStockAlerts),
      expiryAlerts: Boolean(notifications.expiryAlerts ?? base.notifications.expiryAlerts),
      dailySummary: Boolean(notifications.dailySummary ?? base.notifications.dailySummary),
      soundEnabled: Boolean(notifications.soundEnabled ?? base.notifications.soundEnabled),
      lowStockThreshold: toInt(notifications.lowStockThreshold, base.notifications.lowStockThreshold, 0, 100000),
      expiryThresholdDays: toInt(notifications.expiryThresholdDays, base.notifications.expiryThresholdDays, 0, 3650),
    },
    appearance: {
      theme: toTheme(appearance.theme ?? base.appearance.theme),
    },
  };
}

export function getDefaultUserPreferences() {
  return { ...defaultUserPreferences };
}
