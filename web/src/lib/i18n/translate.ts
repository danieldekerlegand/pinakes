// Pure translation lookup with `{{param}}` interpolation and locale fallback
// (US-012). Resolution order: requested locale → fallback (en) → the raw key.
// This is the gradeable "locale switching" primitive — `translate(key, ..., ar)`
// vs `translate(key, ..., en)` returns the two locales' strings.

import type { LocaleCode } from "./locales";
import { DEFAULT_LOCALE } from "./locales";
import type { TranslationKey } from "./resources";
import { RESOURCES, FALLBACK_RESOURCES } from "./resources";

export type TranslateParams = Record<string, string | number>;

/** Replace every `{{name}}` in `template` with params[name] (missing → left as-is). */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

/**
 * Translate a key into `locale`, interpolating params. Falls back to the
 * default locale's string, then to the key itself, so a missing translation
 * degrades gracefully rather than throwing.
 */
export function translate(
  key: TranslationKey,
  locale: LocaleCode = DEFAULT_LOCALE,
  params?: TranslateParams,
): string {
  const dict = RESOURCES[locale] ?? FALLBACK_RESOURCES;
  const template = dict[key] ?? FALLBACK_RESOURCES[key] ?? key;
  return interpolate(template, params);
}

/** True when `locale` has its own (non-fallback) value for `key`. */
export function hasTranslation(key: TranslationKey, locale: LocaleCode): boolean {
  const dict = RESOURCES[locale];
  return Boolean(dict && key in dict);
}
