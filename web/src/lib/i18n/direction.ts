// App-wide RTL support (US-012). Direction is a first-class layout concern —
// not just a `dir="auto"` on individual script samples — so the whole document
// flips for Arabic/Hebrew/Farsi/Urdu. These helpers are pure; the React layer
// applies the result to <html dir>.

import type { LocaleCode, TextDirection } from "./locales";
import { getLocaleMeta } from "./locales";

/**
 * Locales that lay out right-to-left. Kept broader than the shipped UI locales
 * so native-script content (entity names/samples) in any of these scripts gets
 * the correct direction even before a full UI translation exists.
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  "ar", // Arabic
  "he", // Hebrew
  "fa", // Farsi / Persian
  "ur", // Urdu
  "ps", // Pashto
  "syr", // Syriac
  "dv", // Dhivehi
  "arc", // Aramaic
  "yi", // Yiddish
]);

/** True when a language/locale code is written right-to-left. */
export function isRtlLanguage(code: string | null | undefined): boolean {
  if (!code) return false;
  return RTL_LANGUAGES.has(code.trim().toLowerCase().split(/[-_]/)[0]);
}

/** Layout direction for a supported UI locale. */
export function directionForLocale(locale: LocaleCode): TextDirection {
  return getLocaleMeta(locale).dir;
}

/**
 * Direction for a piece of native-script content given its own language code,
 * independent of the active UI locale — e.g. an Arabic place name shown while
 * the UI is in English still needs `dir="rtl"`. Unknown/empty → "auto" so the
 * browser's bidi heuristic takes over.
 */
export function directionForContent(
  languageCode: string | null | undefined,
): TextDirection | "auto" {
  if (!languageCode) return "auto";
  return isRtlLanguage(languageCode) ? "rtl" : "ltr";
}

/** The opposite direction — handy for mirroring a single element. */
export function oppositeDirection(dir: TextDirection): TextDirection {
  return dir === "rtl" ? "ltr" : "rtl";
}
