// UI string catalog (US-012). Scaffold set of externalized strings covering the
// app chrome (header, search, common actions, locale/calendar controls). New
// strings get a key here + a value in every locale; `en` is the source of truth
// and the fallback, so an untranslated key still renders English rather than a
// raw key. Values may contain `{{param}}` placeholders (see translate.ts).

import type { LocaleCode } from "./locales";
import { DEFAULT_LOCALE } from "./locales";

/** Every translatable key. English is authoritative; other locales mirror it. */
export type TranslationKey = keyof typeof en;

const en = {
  "app.title": "Linguistic Family Tree",
  "action.search": "Search...",
  "action.searchEverything": "Search everything",
  "action.close": "Close",
  "action.clear": "Clear",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.export": "Export",
  "nav.explore": "Explore",
  "nav.stories": "Stories",
  "nav.quiz": "Quiz",
  "nav.collections": "Collections",
  "nav.timeline": "Timeline",
  "settings.language": "Language",
  "settings.chooseLanguage": "Choose language",
  "settings.calendar": "Calendar",
  "settings.darkMode": "Toggle dark mode",
  "settings.showSidebar": "Show sidebar",
  "settings.hideSidebar": "Hide sidebar",
  "entity.nativeName": "Native name",
  "entity.romanization": "Romanization",
  "entity.relatedEntities": "Related entities",
  "time.bceCe": "{{year}}",
  "common.loading": "Loading…",
  "common.noResults": "No results",
  "common.resultsCount": "{{count}} results",
} as const;

const ar: Record<TranslationKey, string> = {
  "app.title": "شجرة العائلة اللغوية",
  "action.search": "بحث...",
  "action.searchEverything": "ابحث في كل شيء",
  "action.close": "إغلاق",
  "action.clear": "مسح",
  "action.save": "حفظ",
  "action.cancel": "إلغاء",
  "action.export": "تصدير",
  "nav.explore": "استكشاف",
  "nav.stories": "قصص",
  "nav.quiz": "اختبار",
  "nav.collections": "المجموعات",
  "nav.timeline": "الخط الزمني",
  "settings.language": "اللغة",
  "settings.chooseLanguage": "اختر اللغة",
  "settings.calendar": "التقويم",
  "settings.darkMode": "تبديل الوضع الداكن",
  "settings.showSidebar": "إظهار الشريط الجانبي",
  "settings.hideSidebar": "إخفاء الشريط الجانبي",
  "entity.nativeName": "الاسم الأصلي",
  "entity.romanization": "الكتابة اللاتينية",
  "entity.relatedEntities": "كيانات ذات صلة",
  "time.bceCe": "{{year}}",
  "common.loading": "جارٍ التحميل…",
  "common.noResults": "لا توجد نتائج",
  "common.resultsCount": "{{count}} نتيجة",
};

const es: Record<TranslationKey, string> = {
  "app.title": "Árbol genealógico lingüístico",
  "action.search": "Buscar...",
  "action.searchEverything": "Buscar en todo",
  "action.close": "Cerrar",
  "action.clear": "Limpiar",
  "action.save": "Guardar",
  "action.cancel": "Cancelar",
  "action.export": "Exportar",
  "nav.explore": "Explorar",
  "nav.stories": "Historias",
  "nav.quiz": "Cuestionario",
  "nav.collections": "Colecciones",
  "nav.timeline": "Cronología",
  "settings.language": "Idioma",
  "settings.chooseLanguage": "Elegir idioma",
  "settings.calendar": "Calendario",
  "settings.darkMode": "Alternar modo oscuro",
  "settings.showSidebar": "Mostrar barra lateral",
  "settings.hideSidebar": "Ocultar barra lateral",
  "entity.nativeName": "Nombre nativo",
  "entity.romanization": "Romanización",
  "entity.relatedEntities": "Entidades relacionadas",
  "time.bceCe": "{{year}}",
  "common.loading": "Cargando…",
  "common.noResults": "Sin resultados",
  "common.resultsCount": "{{count}} resultados",
};

/** All translation dictionaries keyed by locale. */
export const RESOURCES: Record<LocaleCode, Record<TranslationKey, string>> = {
  en,
  ar,
  es,
};

/** The dictionary of the fallback locale (never missing a key). */
export const FALLBACK_RESOURCES = RESOURCES[DEFAULT_LOCALE];

/** Every translation key (useful for parity tests + tooling). */
export const TRANSLATION_KEYS = Object.keys(en) as TranslationKey[];
