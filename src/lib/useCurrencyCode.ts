import { useEffect, useState } from 'react';
import { defaultUserSettingsPreferences } from './systemPreferences';

const DEFAULT_CURRENCY_CODE = defaultUserSettingsPreferences.currency.code;

const normalizeCurrencyCode = (value: unknown) => {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return DEFAULT_CURRENCY_CODE;
  return code === 'UZS' ? 'TJS' : code;
};

export const useCurrencyCode = () => {
  const [currencyCode, setCurrencyCode] = useState(DEFAULT_CURRENCY_CODE);

  useEffect(() => {
    let ignore = false;
    const token = window.sessionStorage.getItem('pharmapro_token');

    const loadCurrencyCode = async () => {
      try {
        const response = await fetch('/api/system/me/preferences', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!response.ok) return;

        const body = await response.json().catch(() => null);
        if (!ignore) {
          setCurrencyCode(normalizeCurrencyCode(body?.currency?.code));
        }
      } catch {
        if (!ignore) {
          setCurrencyCode(DEFAULT_CURRENCY_CODE);
        }
      }
    };

    void loadCurrencyCode();

    return () => {
      ignore = true;
    };
  }, []);

  return currencyCode;
};
