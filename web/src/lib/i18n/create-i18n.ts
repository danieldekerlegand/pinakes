// Immutable per-locale i18n instance (US-012). Bundles translation + direction +
// year/date/name formatting bound to one locale, so a component only needs a `t`
// and the formatters. Locale switching is `i18n.withLocale(next)` — a pure
// transition that returns a fresh instance, which is exactly what the React
// context stores in state. Being pure, the whole thing (incl. switching) is
// node-vitest testable without a DOM.

import type { LocaleCode, TextDirection } from "./locales";
import { resolveLocale, getLocaleMeta } from "./locales";
import { directionForLocale } from "./direction";
import type { TranslationKey } from "./resources";
import { translate, type TranslateParams } from "./translate";
import {
  formatHistoricalYear,
  formatCalendarDate,
  calendarsForLocale,
  type HistoricalYearOptions,
  type CalendarDateOptions,
  type CalendarMeta,
} from "./calendars";
import { formatEntityName, type EntityName, type FormattedEntityName } from "./names";

export interface I18n {
  readonly locale: LocaleCode;
  readonly dir: TextDirection;
  /** Translate a key with optional interpolation params. */
  t(key: TranslationKey, params?: TranslateParams): string;
  /** Format a signed timeline year as BCE/CE in this locale. */
  formatYear(year: number, opts?: Omit<HistoricalYearOptions, "locale">): string;
  /** Format a concrete Date under a calendar system in this locale. */
  formatDate(date: Date, opts?: Omit<CalendarDateOptions, "locale">): string;
  /** Format an entity's native/romanized names consistently. */
  formatName(entity: EntityName): FormattedEntityName;
  /** Calendars offered for this locale, most-relevant first. */
  calendars(): readonly CalendarMeta[];
  /** Pure transition to another locale (returns a fresh instance). */
  withLocale(next: string): I18n;
}

/**
 * Build an i18n instance for `locale` (unknown codes resolve to the default
 * locale). Cheap to create — safe to build a new one per locale switch.
 */
export function createI18n(locale: string): I18n {
  const code = resolveLocale(locale);
  const dir = directionForLocale(code);
  return {
    locale: code,
    dir,
    t: (key, params) => translate(key, code, params),
    formatYear: (year, opts) => formatHistoricalYear(year, { ...opts, locale: code }),
    formatDate: (date, opts) => formatCalendarDate(date, { ...opts, locale: code }),
    formatName: (entity) => formatEntityName(entity, { locale: code }),
    calendars: () => calendarsForLocale(code),
    withLocale: (next) => createI18n(next),
  };
}

/** Locale metadata (endonym/dir/default calendar) re-exported for the switcher. */
export { getLocaleMeta };
