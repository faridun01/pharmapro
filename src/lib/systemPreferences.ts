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

export const defaultUserSettingsPreferences: UserSettingsPreferences = {
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
