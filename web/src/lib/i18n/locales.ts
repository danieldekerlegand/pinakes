// Supported UI locales (US-012). Kept dependency-free and pure so the whole
// i18n core is node-vitest testable. The React layer (contexts/I18nContext.tsx)
// wraps these primitives in state and applies <html lang/dir>.
//
// Adding a locale = add a LocaleMeta entry here + a translation dict in
// resources.ts. RTL is derived from `dir`; the default calendar drives
// formatCalendarDate() when the caller does not pass one explicitly.

import type { CalendarSystem } from "./calendars";

export type LocaleCode = "en" | "ar" | "es";

export type TextDirection = "ltr" | "rtl";

export interface LocaleMeta {
  /** BCP-47 language code used for Intl formatting + <html lang>. */
  code: LocaleCode;
  /** English name of the language (for menus in the default locale). */
  englishName: string;
  /** Native name (endonym) of the language, shown in the switcher. */
  endonym: string;
  /** Layout direction for the whole document under this locale. */
  dir: TextDirection;
  /** Calendar used by default when formatting dates under this locale. */
  defaultCalendar: CalendarSystem;
}

/**
 * All supported locales, in menu order. `en` is the source/fallback locale;
 * `ar` is the required non-English locale and exercises RTL + the Islamic
 * calendar; `es` is a second LTR locale so locale-switching is exercised
 * independently of direction changes.
 */
export const LOCALES: readonly LocaleMeta[] = [
  {
    code: "en",
    englishName: "English",
    endonym: "English",
    dir: "ltr",
    defaultCalendar: "gregory",
  },
  {
    code: "ar",
    englishName: "Arabic",
    endonym: "العربية",
    dir: "rtl",
    defaultCalendar: "islamic",
  },
  {
    code: "es",
    englishName: "Spanish",
    endonym: "Español",
    dir: "ltr",
    defaultCalendar: "gregory",
  },
] as const;

/** The source-of-truth locale every other locale falls back to. */
export const DEFAULT_LOCALE: LocaleCode = "en";

const LOCALE_BY_CODE: Record<string, LocaleMeta> = Object.fromEntries(
  LOCALES.map((l) => [l.code, l]),
);

/** Every supported locale code, in menu order. */
export const LOCALE_CODES: readonly LocaleCode[] = LOCALES.map((l) => l.code);

/** True when `code` is a locale the app actually ships translations for. */
export function isSupportedLocale(code: string): code is LocaleCode {
  return code in LOCALE_BY_CODE;
}

/** Metadata for a locale, falling back to the default locale for unknowns. */
export function getLocaleMeta(code: string): LocaleMeta {
  return LOCALE_BY_CODE[code] ?? LOCALE_BY_CODE[DEFAULT_LOCALE];
}

/**
 * Resolve an arbitrary requested locale (e.g. from localStorage or
 * `navigator.language`) to a supported code. Accepts region subtags
 * ("ar-EG" → "ar") and is case-insensitive; unknown values → DEFAULT_LOCALE.
 */
export function resolveLocale(requested: string | null | undefined): LocaleCode {
  if (!requested) return DEFAULT_LOCALE;
  const primary = requested.trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(primary) ? primary : DEFAULT_LOCALE;
}
