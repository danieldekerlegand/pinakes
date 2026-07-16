/**
 * Citation export (US-008) — turn an entity's `sources[]` bibliographic strings into
 * academic citation formats: **BibTeX** (primary), plus **RIS** and **CSL-JSON**.
 *
 * This module is **pure** (no fs / express / storage): it takes a normalized
 * `CitableEntity` and returns text. The route (`server/routes/citations.ts`) owns the
 * storage fetch + HTTP wiring; the unit tests drive these functions directly.
 *
 * Source strings in the corpus are free text — sometimes an `"Author Year"` citation
 * (`"Kuijt 2002"`), sometimes a bare descriptor (`"Archaeological evidence"`), sometimes
 * a JSON-encoded array cell (`'["Hesiod Theogony","Homer Iliad"]'`). We parse what we can
 * (author / year / url) and fall back to a `title`-only entry — never dropping a source.
 *
 * Every export also emits a leading **record entry** that cites the pinakes entity
 * record itself, so an entity with *no* sources still yields a usable citation (AC3).
 */

/** The citation formats this module can emit. */
export type CitationFormat = "bibtex" | "ris" | "csljson";

/** Every supported format, for validation / listing. */
export const CITATION_FORMATS: readonly CitationFormat[] = ["bibtex", "ris", "csljson"];

/** The dataset a record entry attributes to. */
export const DATASET_PUBLISHER = "pinakes cultural dataset";

/**
 * A normalized, format-agnostic view of any citable entity. The route builds this from
 * whichever storage record it fetched (flat rows or GeoJSON `properties`).
 */
export interface CitableEntity {
  /** Kebab entity type, e.g. `"culture-profile"`, `"civilization"`, `"deity"`. */
  entityType: string;
  /** Stable entity id (the citation-key stem). */
  id: string;
  /** Human-readable name (the record entry's title). */
  name: string;
  /** Raw bibliographic source strings (may be empty). */
  sources: string[];
  /** A representative year for the record (founding / origin); negative = BCE. */
  year?: number | null;
  /** Region / origin, surfaced in the record entry's note. */
  region?: string | null;
  /** Canonical URL to this entity, if the caller can build one. */
  url?: string | null;
}

/** A source string parsed into whatever structured fields we could recover. */
export interface ParsedSource {
  /** The original, untouched source string. */
  raw: string;
  /** Recovered author (the text before a trailing year), when present. */
  author?: string;
  /** Recovered 3–4 digit year, when present. */
  year?: number;
  /** First http(s) URL found in the string, when present. */
  url?: string;
  /** The citation title — the author-stripped remainder, else the whole string. */
  title: string;
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;
/** A trailing " 2002" / " 2002)" style year at the END of a citation. */
const TRAILING_YEAR = /[\s(](\d{3,4})\)?\s*$/;

/**
 * Coerce a raw `sources` cell into `string[]`. Accepts a real array (the live storage
 * shape), a JSON-array string (a raw TSV cell, `'["a","b"]'`), or a single string.
 * Blanks are dropped; nothing else is inspected. Never throws.
 */
export function parseEntitySources(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value === "") return [];
    if (value.startsWith("[")) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parseEntitySources(parsed);
      } catch {
        // fall through: treat the raw string as one source
      }
    }
    return [value];
  }
  return [];
}

/** Parse one free-text source string into whatever structured fields we can recover. */
export function parseSourceString(raw: string): ParsedSource {
  const trimmed = raw.trim();
  const parsed: ParsedSource = { raw: trimmed, title: trimmed };

  const urlMatch = trimmed.match(URL_PATTERN);
  if (urlMatch) parsed.url = urlMatch[0];

  const yearMatch = trimmed.match(TRAILING_YEAR);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    // Only treat plausible years as years (avoid, e.g., a "100" quantity).
    if (Number.isFinite(year) && year >= 100 && year <= 2100) {
      parsed.year = year;
      const author = trimmed.slice(0, yearMatch.index).trim().replace(/[,(]\s*$/, "").trim();
      if (author !== "") {
        parsed.author = author;
        parsed.title = author;
      }
    }
  }
  return parsed;
}

/** Lowercase kebab slug of arbitrary text, safe for a BibTeX / RIS citation key. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** BibTeX field-value escaping for the small set of TeX specials we may encounter. */
function escapeBibtex(value: string): string {
  return value.replace(/([&%$#_])/g, "\\$1").replace(/[{}]/g, "");
}

/** A stable base citation key for an entity's record entry. */
export function recordCiteKey(entity: CitableEntity): string {
  return slug(`pinakes-${entity.entityType}-${entity.id}`) || "pinakes-record";
}

/**
 * Build the ordered, de-duplicated list of citation keys for an entity: the record entry
 * first, then one per source. Author+year keys read naturally (`minoan-kuijt-2002`); a
 * collision or an untitled source falls back to an index suffix.
 */
function buildKeys(entity: CitableEntity, sources: ParsedSource[]): string[] {
  const used = new Set<string>();
  const take = (candidate: string, fallback: string): string => {
    let key = candidate || fallback;
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key}-${n}`)) n += 1;
      key = `${key}-${n}`;
    }
    used.add(key);
    return key;
  };

  const keys = [take(recordCiteKey(entity), "pinakes-record")];
  const stem = slug(entity.id) || slug(entity.name) || "source";
  sources.forEach((src, i) => {
    const parts = [stem, src.author ? slug(src.author) : "", src.year ? String(src.year) : ""]
      .filter(Boolean)
      .join("-");
    keys.push(take(slug(parts), `${stem}-source-${i + 1}`));
  });
  return keys;
}

/** A one-line entity descriptor for the record-entry note. */
function recordNote(entity: CitableEntity): string {
  const bits = [`pinakes ${entity.entityType.replace(/-/g, " ")} record`];
  if (entity.region) bits.push(`region: ${entity.region}`);
  return bits.join("; ");
}

/** Serialize an entity to a BibTeX document (record entry + one entry per source). */
export function entityToBibtex(entity: CitableEntity): string {
  const sources = entity.sources.map(parseSourceString);
  const keys = buildKeys(entity, sources);
  const entries: string[] = [];

  const recordFields: string[] = [
    `  title = {${escapeBibtex(entity.name)}}`,
    `  howpublished = {${escapeBibtex(DATASET_PUBLISHER)}}`,
  ];
  if (entity.year != null) recordFields.push(`  year = {${entity.year}}`);
  if (entity.url) recordFields.push(`  url = {${entity.url}}`);
  recordFields.push(`  note = {${escapeBibtex(recordNote(entity))}}`);
  entries.push(`@misc{${keys[0]},\n${recordFields.join(",\n")}\n}`);

  sources.forEach((src, i) => {
    const fields: string[] = [];
    if (src.author) fields.push(`  author = {${escapeBibtex(src.author)}}`);
    fields.push(`  title = {${escapeBibtex(src.title)}}`);
    if (src.year) fields.push(`  year = {${src.year}}`);
    if (src.url) fields.push(`  url = {${src.url}}`);
    fields.push(`  note = {${escapeBibtex(`Source cited for ${entity.name}`)}}`);
    entries.push(`@misc{${keys[i + 1]},\n${fields.join(",\n")}\n}`);
  });

  return entries.join("\n\n") + "\n";
}

/** Serialize an entity to an RIS document. */
export function entityToRis(entity: CitableEntity): string {
  const sources = entity.sources.map(parseSourceString);
  const records: string[] = [];

  const record: string[] = ["TY  - DATA", `TI  - ${entity.name}`, `PB  - ${DATASET_PUBLISHER}`];
  if (entity.year != null) record.push(`PY  - ${entity.year}`);
  if (entity.url) record.push(`UR  - ${entity.url}`);
  record.push(`N1  - ${recordNote(entity)}`, "ER  - ");
  records.push(record.join("\n"));

  sources.forEach((src) => {
    const lines: string[] = ["TY  - GEN"];
    if (src.author) lines.push(`AU  - ${src.author}`);
    lines.push(`TI  - ${src.title}`);
    if (src.year) lines.push(`PY  - ${src.year}`);
    if (src.url) lines.push(`UR  - ${src.url}`);
    lines.push(`N1  - Source cited for ${entity.name}`, "ER  - ");
    records.push(lines.join("\n"));
  });

  return records.join("\n\n") + "\n";
}

/** A single CSL-JSON item (the subset of CSL fields we populate). */
export interface CslItem {
  id: string;
  type: string;
  title: string;
  author?: { family: string }[];
  issued?: { "date-parts": number[][] };
  publisher?: string;
  URL?: string;
  note?: string;
}

/** Serialize an entity to CSL-JSON items (record item + one per source). */
export function entityToCslItems(entity: CitableEntity): CslItem[] {
  const sources = entity.sources.map(parseSourceString);
  const keys = buildKeys(entity, sources);

  const record: CslItem = {
    id: keys[0],
    type: "dataset",
    title: entity.name,
    publisher: DATASET_PUBLISHER,
    note: recordNote(entity),
  };
  if (entity.year != null) record.issued = { "date-parts": [[entity.year]] };
  if (entity.url) record.URL = entity.url;

  const items: CslItem[] = [record];
  sources.forEach((src, i) => {
    const item: CslItem = { id: keys[i + 1], type: "document", title: src.title };
    if (src.author) item.author = [{ family: src.author }];
    if (src.year) item.issued = { "date-parts": [[src.year]] };
    if (src.url) item.URL = src.url;
    item.note = `Source cited for ${entity.name}`;
    items.push(item);
  });
  return items;
}

/** Serialize an entity to a CSL-JSON document string. */
export function entityToCslJson(entity: CitableEntity): string {
  return JSON.stringify(entityToCslItems(entity), null, 2) + "\n";
}

/** The rendered citation payload plus its HTTP metadata for a download response. */
export interface CitationRender {
  format: CitationFormat;
  content: string;
  contentType: string;
  /** A download filename (no path), e.g. `minoan.bib`. */
  filename: string;
}

/** Narrowing guard: is `value` a supported citation format? */
export function isCitationFormat(value: unknown): value is CitationFormat {
  return typeof value === "string" && (CITATION_FORMATS as readonly string[]).includes(value);
}

const FORMAT_META: Record<CitationFormat, { ext: string; contentType: string }> = {
  bibtex: { ext: "bib", contentType: "application/x-bibtex; charset=utf-8" },
  ris: { ext: "ris", contentType: "application/x-research-info-systems; charset=utf-8" },
  csljson: { ext: "json", contentType: "application/vnd.citationstyles.csl+json; charset=utf-8" },
};

/** Render an entity in the requested format, ready to stream as a download. */
export function renderCitation(entity: CitableEntity, format: CitationFormat): CitationRender {
  const content =
    format === "bibtex"
      ? entityToBibtex(entity)
      : format === "ris"
        ? entityToRis(entity)
        : entityToCslJson(entity);
  const meta = FORMAT_META[format];
  const base = slug(entity.id) || slug(entity.name) || "citation";
  return { format, content, contentType: meta.contentType, filename: `${base}.${meta.ext}` };
}
