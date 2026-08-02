// React binding for the pure i18n core (US-012). Holds the active locale in
// state, persists it, and applies <html lang/dir> so the whole document flips
// to RTL for Arabic/Hebrew/Farsi — not just individual script samples. All the
// actual logic lives in @/lib/i18n (pure, node-tested); this file is only glue.

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  createI18n,
  resolveLocale,
  DEFAULT_LOCALE,
  type I18n,
  type LocaleCode,
} from "@/lib/i18n";

const STORAGE_KEY = "pinakes.locale";

interface I18nContextValue extends I18n {
  setLocale: (next: LocaleCode) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Read the saved locale (falling back to navigator.language, then default). */
function readInitialLocale(): LocaleCode {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return resolveLocale(saved);
  } catch {
    // localStorage may be unavailable (private mode) — fall through.
  }
  return resolveLocale(window.navigator?.language);
}

/** Reflect the active locale onto the document root for CSS + assistive tech. */
function applyDocumentLocale(i18n: I18n): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.lang = i18n.locale;
  root.dir = i18n.dir;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(readInitialLocale);
  const i18n = useMemo(() => createI18n(locale), [locale]);

  useEffect(() => {
    applyDocumentLocale(i18n);
  }, [i18n]);

  const setLocale = useCallback((next: LocaleCode) => {
    const resolved = resolveLocale(next);
    setLocaleState(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, resolved);
    } catch {
      // Non-fatal: persistence is best-effort.
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ ...i18n, setLocale }),
    [i18n, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Access the active i18n instance. Outside a provider it degrades to a stable
 * default-locale instance so components (and tests) never crash for lack of a
 * provider — the app just renders untranslated English, LTR.
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const fallback = createI18n(DEFAULT_LOCALE);
  return { ...fallback, setLocale: () => {} };
}

/** Convenience hook returning just the translate function. */
export function useTranslation() {
  const { t, locale, dir } = useI18n();
  return { t, locale, dir };
}
