import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Locale, translate } from '@/lib/i18n';

const LOCALE_KEY = 'cmp_locale';

type LocaleContextValue = {
  locale: Locale;
  ready: boolean;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(LOCALE_KEY);
        if (stored === 'en' || stored === 'zh-Hant') {
          setLocaleState(stored);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  async function setLocale(locale: Locale) {
    setLocaleState(locale);
    await AsyncStorage.setItem(LOCALE_KEY, locale);
  }

  const value = useMemo(
    () => ({ locale, ready, setLocale, t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars) }),
    [locale, ready]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
