// Consistent native-script + romanization display for entity names (US-012).
// Domains carry names in several shapes (a plain label, a native-script form,
// and/or a romanized/transliterated form). This gives every detail panel one
// way to render them together, with the correct text direction on the
// native-script part, so it reads consistently across languages, civilizations,
// religions, battles, etc.

import type { LocaleCode } from "./locales";
import { directionForContent } from "./direction";

export interface EntityName {
  /** Primary display label (usually English/romanized). */
  name?: string | null;
  /** Name in its own script (e.g. "مصر", "中國", "Ἑλλάς"). */
  native?: string | null;
  /** Explicit romanization/transliteration, if distinct from `name`. */
  romanization?: string | null;
  /** BCP-47 language code of the native form, for its text direction. */
  languageCode?: string | null;
}

export interface FormattedEntityName {
  /** The main line to show (romanized/primary). */
  primary: string;
  /** The native-script form, or "" when absent/duplicate of primary. */
  native: string;
  /** dir attribute value to apply to the native part. */
  nativeDir: "ltr" | "rtl" | "auto";
  /** A single-line combined string, e.g. "Egypt (مصر)". */
  combined: string;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Normalize an EntityName into a consistent primary + native pair.
 *
 * - `primary` prefers the explicit `name`, then romanization, then native.
 * - `native` is only surfaced when it differs from the primary (so we never
 *   print "مصر (مصر)").
 * - `nativeDir` comes from the native form's own language code (RTL-aware),
 *   independent of the active UI locale.
 */
export function formatEntityName(
  entity: EntityName,
  _opts: { locale?: LocaleCode } = {},
): FormattedEntityName {
  const name = clean(entity.name);
  const native = clean(entity.native);
  const romanization = clean(entity.romanization);

  const primary = name || romanization || native;
  const showNative = native !== "" && native !== primary;
  const nativeDir = showNative ? directionForContent(entity.languageCode) : "auto";

  // If we have a distinct romanization *and* the primary wasn't already it,
  // fold it in as a parenthetical hint after the primary.
  const romanHint = romanization && romanization !== primary && romanization !== native
    ? romanization
    : "";

  let combined = primary;
  const extras = [native !== primary ? native : "", romanHint].filter(Boolean);
  if (extras.length) combined = `${primary} (${extras.join(", ")})`;

  return {
    primary,
    native: showNative ? native : "",
    nativeDir,
    combined,
  };
}
