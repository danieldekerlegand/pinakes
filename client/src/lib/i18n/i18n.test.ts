import { describe, it, expect } from "vitest";
import {
  LOCALES,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  isSupportedLocale,
  getLocaleMeta,
  resolveLocale,
} from "./locales";
import {
  RTL_LANGUAGES,
  isRtlLanguage,
  directionForLocale,
  directionForContent,
  oppositeDirection,
} from "./direction";
import {
  interpolate,
  translate,
  hasTranslation,
} from "./translate";
import { RESOURCES, TRANSLATION_KEYS, FALLBACK_RESOURCES } from "./resources";
import {
  formatHistoricalYear,
  formatCalendarDate,
  calendarsForLocale,
  withCalendar,
  CALENDARS,
} from "./calendars";
import { formatEntityName } from "./names";
import { createI18n } from "./create-i18n";

describe("locales", () => {
  it("exposes en as the default/fallback locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALE_CODES).toContain("en");
    expect(LOCALE_CODES).toContain("ar");
  });

  it("resolves region subtags and casing to a supported code", () => {
    expect(resolveLocale("ar-EG")).toBe("ar");
    expect(resolveLocale("AR")).toBe("ar");
    expect(resolveLocale("es_MX")).toBe("es");
    expect(resolveLocale("en-US")).toBe("en");
  });

  it("falls back to the default locale for unknown/empty input", () => {
    expect(resolveLocale("zz")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("isSupportedLocale + getLocaleMeta agree", () => {
    expect(isSupportedLocale("ar")).toBe(true);
    expect(isSupportedLocale("zz")).toBe(false);
    expect(getLocaleMeta("ar").dir).toBe("rtl");
    expect(getLocaleMeta("zz").code).toBe("en"); // fallback
  });

  it("every locale has an endonym", () => {
    for (const l of LOCALES) expect(l.endonym.length).toBeGreaterThan(0);
  });
});

describe("direction / RTL", () => {
  it("classifies known RTL languages", () => {
    for (const code of ["ar", "he", "fa", "ur"]) {
      expect(isRtlLanguage(code)).toBe(true);
      expect(RTL_LANGUAGES.has(code)).toBe(true);
    }
  });

  it("treats English/Spanish/unknown as not RTL", () => {
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("es")).toBe(false);
    expect(isRtlLanguage("")).toBe(false);
    expect(isRtlLanguage(null)).toBe(false);
  });

  it("directionForLocale flips only for RTL UI locales", () => {
    expect(directionForLocale("en")).toBe("ltr");
    expect(directionForLocale("es")).toBe("ltr");
    expect(directionForLocale("ar")).toBe("rtl");
  });

  it("directionForContent is content-language driven, not UI-locale driven", () => {
    expect(directionForContent("ar")).toBe("rtl");
    expect(directionForContent("en")).toBe("ltr");
    expect(directionForContent(null)).toBe("auto");
    expect(directionForContent("")).toBe("auto");
  });

  it("oppositeDirection mirrors", () => {
    expect(oppositeDirection("rtl")).toBe("ltr");
    expect(oppositeDirection("ltr")).toBe("rtl");
  });
});

describe("translate + interpolation", () => {
  it("interpolates named params and leaves unknown placeholders intact", () => {
    expect(interpolate("Hi {{name}}", { name: "Ada" })).toBe("Hi Ada");
    expect(interpolate("{{count}} results", { count: 3 })).toBe("3 results");
    expect(interpolate("Hi {{name}}", {})).toBe("Hi {{name}}");
    expect(interpolate("no params")).toBe("no params");
  });

  it("returns locale-specific strings (locale switching at the data layer)", () => {
    expect(translate("action.search", "en")).toBe("Search...");
    expect(translate("action.search", "ar")).toBe("بحث...");
    expect(translate("action.search", "es")).toBe("Buscar...");
  });

  it("falls back to English for a missing locale, then to the key", () => {
    // @ts-expect-error unknown locale exercises the fallback path
    expect(translate("action.save", "zz")).toBe(FALLBACK_RESOURCES["action.save"]);
    // @ts-expect-error unknown key exercises key fallback
    expect(translate("does.not.exist", "en")).toBe("does.not.exist");
  });

  it("interpolates through translate", () => {
    expect(translate("common.resultsCount", "en", { count: 5 })).toBe("5 results");
    expect(translate("common.resultsCount", "es", { count: 5 })).toBe("5 resultados");
  });

  it("hasTranslation reports real per-locale coverage", () => {
    expect(hasTranslation("action.save", "ar")).toBe(true);
    // @ts-expect-error unknown locale
    expect(hasTranslation("action.save", "zz")).toBe(false);
  });
});

describe("resource parity", () => {
  it("every locale defines every key exactly", () => {
    for (const code of LOCALE_CODES) {
      const dict = RESOURCES[code];
      for (const key of TRANSLATION_KEYS) {
        expect(dict[key], `${code} missing ${key}`).toBeDefined();
        expect(dict[key].length).toBeGreaterThan(0);
      }
      expect(Object.keys(dict).sort()).toEqual([...TRANSLATION_KEYS].sort());
    }
  });
});

describe("historical year (BCE/CE)", () => {
  it("formats negative years as BCE and positive as CE (en)", () => {
    expect(formatHistoricalYear(-3500, { locale: "en" })).toBe("3,500 BCE");
    expect(formatHistoricalYear(476, { locale: "en" })).toBe("476 CE");
  });

  it("treats year 0 as 1 BCE", () => {
    expect(formatHistoricalYear(0, { locale: "en" })).toBe("1 BCE");
  });

  it("supports a long era style", () => {
    expect(formatHistoricalYear(-100, { locale: "en", style: "long" })).toBe(
      "100 Before Common Era",
    );
  });

  it("localizes era labels", () => {
    expect(formatHistoricalYear(-100, { locale: "es" })).toBe("100 a.C.");
    expect(formatHistoricalYear(100, { locale: "es" })).toBe("100 d.C.");
    expect(formatHistoricalYear(-100, { locale: "ar" })).toContain("ق.م");
  });
});

describe("calendar date formatting", () => {
  // Midday UTC so the calendar day/year is stable across the runner's timezone.
  const d = new Date(Date.UTC(2024, 5, 15, 12)); // 2024-06-15

  it("formats a Gregorian date", () => {
    const out = formatCalendarDate(d, { locale: "en", calendar: "gregory" });
    expect(out).toContain("2024");
  });

  it("formats an Islamic (Hijri) date distinct from Gregorian", () => {
    const hijri = formatCalendarDate(d, { locale: "en", calendar: "islamic" });
    const greg = formatCalendarDate(d, { locale: "en", calendar: "gregory" });
    expect(hijri).not.toBe(greg);
    // 2024-01-01 falls in AH 1445
    expect(hijri).toContain("1445");
  });

  it("formats a Chinese-calendar date without throwing", () => {
    const cn = formatCalendarDate(d, { locale: "en", calendar: "chinese" });
    expect(cn.length).toBeGreaterThan(0);
  });

  it("uses the locale's default calendar when none is given", () => {
    // ar defaults to islamic
    const arDefault = formatCalendarDate(d, { locale: "ar" });
    const arIslamic = formatCalendarDate(d, { locale: "ar", calendar: "islamic" });
    expect(arDefault).toBe(arIslamic);
  });

  it("returns '' for an invalid date", () => {
    expect(formatCalendarDate(new Date("nonsense"), { locale: "en" })).toBe("");
  });

  it("withCalendar builds a Unicode -u-ca- locale", () => {
    expect(withCalendar("ar", "islamic")).toBe("ar-u-ca-islamic");
  });

  it("calendarsForLocale puts the locale default first, gregory reachable", () => {
    const arOrder = calendarsForLocale("ar");
    expect(arOrder[0].system).toBe("islamic");
    expect(arOrder.map((c) => c.system)).toContain("gregory");
    expect(calendarsForLocale("en")[0].system).toBe("gregory");
    expect(arOrder.length).toBe(CALENDARS.length);
  });
});

describe("entity name formatting (native + romanization)", () => {
  it("shows native alongside the primary label", () => {
    const f = formatEntityName({ name: "Egypt", native: "مصر", languageCode: "ar" });
    expect(f.primary).toBe("Egypt");
    expect(f.native).toBe("مصر");
    expect(f.nativeDir).toBe("rtl");
    expect(f.combined).toBe("Egypt (مصر)");
  });

  it("never duplicates when native equals primary", () => {
    const f = formatEntityName({ name: "مصر", native: "مصر", languageCode: "ar" });
    expect(f.native).toBe("");
    expect(f.combined).toBe("مصر");
  });

  it("folds in a distinct romanization", () => {
    const f = formatEntityName({
      name: "China",
      native: "中國",
      romanization: "Zhōngguó",
      languageCode: "zh",
    });
    expect(f.primary).toBe("China");
    expect(f.nativeDir).toBe("ltr");
    expect(f.combined).toBe("China (中國, Zhōngguó)");
  });

  it("falls back through romanization/native when name is absent", () => {
    expect(formatEntityName({ romanization: "Hellas", native: "Ἑλλάς" }).primary).toBe(
      "Hellas",
    );
    expect(formatEntityName({ native: "日本" }).primary).toBe("日本");
    expect(formatEntityName({}).combined).toBe("");
  });
});

describe("createI18n instance + locale switching", () => {
  it("binds translate + formatters to a locale", () => {
    const en = createI18n("en");
    expect(en.locale).toBe("en");
    expect(en.dir).toBe("ltr");
    expect(en.t("action.search")).toBe("Search...");
    expect(en.formatYear(-500)).toBe("500 BCE");
    expect(en.t("common.resultsCount", { count: 2 })).toBe("2 results");
  });

  it("withLocale is a pure transition to a fresh RTL instance", () => {
    const en = createI18n("en");
    const ar = en.withLocale("ar");
    expect(en.locale).toBe("en"); // original untouched
    expect(ar.locale).toBe("ar");
    expect(ar.dir).toBe("rtl");
    expect(ar.t("action.search")).toBe("بحث...");
    expect(ar.calendars()[0].system).toBe("islamic");
  });

  it("resolves unknown codes to the default locale", () => {
    expect(createI18n("zz").locale).toBe("en");
    expect(createI18n("ar-EG").locale).toBe("ar");
  });
});
