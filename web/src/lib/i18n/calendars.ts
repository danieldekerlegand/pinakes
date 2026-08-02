// Localized date/calendar formatting (US-012). Two distinct concerns:
//
//  1. Historical YEARS on the app's deep-time axis (e.g. -3500) are formatted
//     BCE/CE via `formatHistoricalYear` — the app's timelines predate the
//     Gregorian epoch, so an absolute year + era label is the right primitive
//     (Intl date formatting is not designed for -3500).
//  2. Concrete calendar DATES (a real Date) are formatted through Intl with a
//     selectable calendar system (Islamic / Chinese / Gregorian) so a locale can
//     show, e.g., an Islamic-calendar date alongside the Gregorian one.
//
// All functions are pure and rely only on the platform Intl implementation.

import type { LocaleCode } from "./locales";
import { getLocaleMeta } from "./locales";

/** Calendar systems the UI can format into (Intl `ca` keyword values). */
export type CalendarSystem = "gregory" | "islamic" | "chinese" | "hebrew" | "persian";

export interface CalendarMeta {
  system: CalendarSystem;
  /** English label for menus. */
  label: string;
  /** Era abbreviation shown after a year where meaningful. */
  eraSuffix?: string;
}

export const CALENDARS: readonly CalendarMeta[] = [
  { system: "gregory", label: "Gregorian" },
  { system: "islamic", label: "Islamic (Hijri)", eraSuffix: "AH" },
  { system: "chinese", label: "Chinese" },
  { system: "hebrew", label: "Hebrew", eraSuffix: "AM" },
  { system: "persian", label: "Persian (Solar Hijri)" },
] as const;

/**
 * Calendars offered for a locale, most-relevant first: the locale's default
 * calendar, then Gregorian (always available for reference), then the rest.
 */
export function calendarsForLocale(locale: LocaleCode): readonly CalendarMeta[] {
  const preferred = getLocaleMeta(locale).defaultCalendar;
  return [...CALENDARS].sort((a, b) => {
    const rank = (c: CalendarSystem) => (c === preferred ? 0 : c === "gregory" ? 1 : 2);
    return rank(a.system) - rank(b.system);
  });
}

export interface HistoricalYearOptions {
  locale?: LocaleCode;
  /**
   * "short" → "3500 BCE" (default); "long" → localized "3500 Before Common Era".
   */
  style?: "short" | "long";
}

const ERA_LABELS: Record<LocaleCode, { bce: [string, string]; ce: [string, string] }> = {
  // [short, long]
  en: { bce: ["BCE", "Before Common Era"], ce: ["CE", "Common Era"] },
  ar: { bce: ["ق.م", "قبل الميلاد"], ce: ["م", "ميلادي"] },
  es: { bce: ["a.C.", "antes de Cristo"], ce: ["d.C.", "después de Cristo"] },
};

/**
 * Format a signed astronomical-ish year on the app timeline as an era-labelled
 * year. Year 0 is treated as 1 BCE (there is no year zero in BCE/CE reckoning),
 * matching how the timelines already read (`year < 0 => BCE`).
 * The absolute year is grouped per the locale (e.g. Arabic-Indic digits).
 */
export function formatHistoricalYear(
  year: number,
  { locale = "en", style = "short" }: HistoricalYearOptions = {},
): string {
  const era = year <= 0 ? "bce" : "ce";
  // 0 and -1 are both "1 BCE"; -3500 is "3501 BCE" astronomically, but the app
  // stores plain BCE magnitudes (-3500 means 3500 BCE), so use the magnitude
  // directly and only special-case 0 → 1 BCE.
  const magnitude = year === 0 ? 1 : Math.abs(year);
  const label = (ERA_LABELS[locale] ?? ERA_LABELS.en)[era][style === "long" ? 1 : 0];
  const num = new Intl.NumberFormat(locale, { useGrouping: true }).format(magnitude);
  return `${num} ${label}`;
}

export interface CalendarDateOptions {
  locale?: LocaleCode;
  /** Defaults to the locale's default calendar. */
  calendar?: CalendarSystem;
  /** Intl dateStyle preset; ignored when explicit field options are given. */
  dateStyle?: "full" | "long" | "medium" | "short";
}

/**
 * Format a concrete Date under a chosen calendar system + locale. Falls back to
 * the Gregorian calendar if the platform Intl cannot honor the requested one,
 * so this never throws for a valid Date.
 */
export function formatCalendarDate(
  date: Date,
  { locale = "en", calendar, dateStyle = "long" }: CalendarDateOptions = {},
): string {
  if (Number.isNaN(date.getTime())) return "";
  const cal = calendar ?? getLocaleMeta(locale).defaultCalendar;
  try {
    return new Intl.DateTimeFormat(withCalendar(locale, cal), { dateStyle }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle }).format(date);
  }
}

/** Build a Unicode locale string that pins the calendar, e.g. "ar-u-ca-islamic". */
export function withCalendar(locale: LocaleCode, calendar: CalendarSystem): string {
  return `${locale}-u-ca-${calendar}`;
}
