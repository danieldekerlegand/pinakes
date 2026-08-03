# web/src/lib/i18n — internationalization core (US-012)

**Dependency-free** i18n (no react-i18next). Pure, node-vitest-testable core here;
React glue in `web/src/contexts/I18nContext.tsx` + `components/LocaleSwitcher.tsx`.
Full contract: `docs/i18n.md`.

- **English is the source of truth.** `TranslationKey` is derived from the `en`
  dict in `resources.ts` (`keyof typeof en`). Every other locale is
  `Record<TranslationKey, string>`, so a missing key is a *type* error, and a
  parity test asserts every locale has every key. `translate()` falls back
  requested-locale → `en` → the raw key; it never throws.
- **`createI18n(locale)` is the immutable instance** the React context stores in
  state; locale switching is the pure transition `i18n.withLocale(next)`. Bind
  components to `t` + `formatYear`/`formatDate`/`formatName` from `useI18n()`.
- **RTL is document-wide.** `I18nProvider` writes `document.documentElement.dir`
  + `lang` on locale change. `directionForContent(langCode)` gives per-string
  direction for native-script content even under an LTR UI — used by
  `formatEntityName`.
- **Years vs dates are different primitives.** Deep-time axis years (e.g. -3500)
  → `formatHistoricalYear` (BCE/CE, localized era labels, grouped digits, year 0
  = 1 BCE). Concrete `Date`s → `formatCalendarDate` (Intl `…-u-ca-<cal>`,
  Islamic/Chinese/etc.), Gregorian fallback, `""` for invalid dates.
- **Test gotcha:** build fixture `Date`s at midday UTC (`Date.UTC(y,m,d,12)`) so
  the formatted day/year is timezone-stable in CI.
