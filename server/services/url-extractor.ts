/**
 * URL-paste entity extractor (US-004).
 *
 * Turns a pasted **Wikipedia** or **Wikidata** URL into a structured, per-field
 * entity *draft* (name, description, coordinates, dates, relationships) that
 * lands in the *contribution review queue* — never the live dataset. Every field
 * carries a confidence and the draft is flagged `aiGenerated`/`autoDerived` so a
 * reviewer (US-009) can accept/edit before anything is promoted to TSV.
 *
 * **Wikidata resolution does not reimplement SPARQL in TS.** A single pasted URL
 * is one entity, so we resolve it via Wikidata's *single-entity* REST endpoint
 * (`Special:EntityData/<QID>.json`) — the light lookup primitive, not the SPARQL
 * Query Service. The statement → canonical-field vocabulary here is deliberately
 * kept **aligned with culture-scrape's hydration profile**
 * (`packages/culture-scrape/src/culturescrape/acquire/wikidata_hydration.py`):
 * P571 inception → start year, P625 coordinate location → lat/lon, P144 based-on /
 * P737 influenced-by / P279 subclass-of → relationships, etc. Bulk SPARQL *set*
 * acquisition (a category = a query) stays culture-scrape's job (US-005); this
 * module only maps a single entity's statements the same way.
 *
 * All network access is behind the injectable {@link UrlExtractorDeps} so tests
 * drive the extractor with recorded Wikidata/Wikipedia fixtures (no live fetch).
 */

import type { ContributionEntityType, Contribution } from "./contribution-service";

// ── Public draft shape ────────────────────────────────────────────────────────

/** A single extracted value with a 0..1 confidence. */
export interface FieldValue<T> {
  value: T;
  /** Extraction confidence, 0 (guess) … 1 (verbatim from source). */
  confidence: number;
}

/** One relationship surfaced from a Wikidata statement (target may be unlabeled). */
export interface DraftRelationship {
  /** Human-readable relationship label (e.g. `influenced-by`, `subclass-of`). */
  type: string;
  /** The source Wikidata property id (e.g. `P737`). */
  property: string;
  /** Target entity QID. */
  targetQid: string;
  /** Target label when the source payload carried one, else the QID. */
  targetLabel: string;
  confidence: number;
}

/** The structured, auto-derived draft returned to the client + queued for review. */
export interface EntityDraft {
  /** `wikidata` or `wikipedia` — where the paste came from. */
  kind: SourceKind;
  /** Resolved Wikidata QID (present for both kinds once resolved). */
  wikidataQid?: string;
  /** Canonical source URL the draft was derived from. */
  sourceUrl: string;
  name: FieldValue<string>;
  description?: FieldValue<string>;
  coordinates?: FieldValue<{ lat: number; lng: number }>;
  /** Start year (negative = BCE), from inception / birth. */
  timePeriodStart?: FieldValue<number>;
  /** End year, from dissolved / death. */
  timePeriodEnd?: FieldValue<number>;
  relationships: DraftRelationship[];
  /** Always true — every URL draft is machine-derived and unverified. */
  aiGenerated: true;
  autoDerived: true;
}

export type SourceKind = "wikidata" | "wikipedia";

/** Raised when a URL is not a recognizable Wikipedia/Wikidata link. */
export class UrlExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlExtractionError";
  }
}

// ── URL parsing ───────────────────────────────────────────────────────────────

export interface ParsedSource {
  kind: SourceKind;
  /** Present for `wikidata`. */
  qid?: string;
  /** Present for `wikipedia` — the (decoded) article title. */
  title?: string;
  /** Present for `wikipedia` — the language subdomain (e.g. `en`). */
  lang?: string;
}

const QID_RE = /^Q\d+$/;

/**
 * Classify a pasted URL as Wikidata (→ QID) or Wikipedia (→ lang + title).
 * @throws {UrlExtractionError} when the host/path is not recognized.
 */
export function parseSourceUrl(raw: string): ParsedSource {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new UrlExtractionError("A url is required");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UrlExtractionError(`Not a valid URL: ${trimmed}`);
  }

  const host = url.hostname.toLowerCase();

  // Wikidata: /wiki/Q42, /entity/Q42, /wiki/Special:EntityData/Q42
  if (host === "www.wikidata.org" || host === "wikidata.org") {
    const match = url.pathname.match(/(Q\d+)/);
    if (!match) {
      throw new UrlExtractionError(`No Wikidata QID found in ${trimmed}`);
    }
    return { kind: "wikidata", qid: match[1] };
  }

  // Wikipedia: <lang>.wikipedia.org/wiki/<Title>
  if (host.endsWith(".wikipedia.org")) {
    const lang = host.split(".")[0] || "en";
    const wikiPrefix = "/wiki/";
    if (!url.pathname.startsWith(wikiPrefix)) {
      throw new UrlExtractionError(`Not a Wikipedia article URL: ${trimmed}`);
    }
    const rawTitle = url.pathname.slice(wikiPrefix.length);
    if (!rawTitle) throw new UrlExtractionError(`No article title in ${trimmed}`);
    let title: string;
    try {
      title = decodeURIComponent(rawTitle).replace(/_/g, " ");
    } catch {
      title = rawTitle.replace(/_/g, " ");
    }
    return { kind: "wikipedia", lang, title };
  }

  throw new UrlExtractionError(
    `Unsupported source. Paste a Wikipedia or Wikidata URL (got host ${host}).`,
  );
}

// ── Wikidata entity JSON (Special:EntityData/<QID>.json subset) ────────────────

interface WikidataSnakValue {
  // globecoordinate
  latitude?: number;
  longitude?: number;
  // time
  time?: string;
  // wikibase-entityid
  id?: string;
}

interface WikidataClaim {
  mainsnak?: {
    snaktype?: string;
    datavalue?: { value?: WikidataSnakValue; type?: string };
  };
}

interface WikidataMonolingual {
  language: string;
  value: string;
}

export interface WikidataEntity {
  id: string;
  labels?: Record<string, WikidataMonolingual>;
  descriptions?: Record<string, WikidataMonolingual>;
  claims?: Record<string, WikidataClaim[]>;
}

/** Full Special:EntityData payload — `{ entities: { Q42: {...} } }`. */
export interface WikidataEntityData {
  entities: Record<string, WikidataEntity>;
}

/** A resolved Wikipedia page: the article's Wikidata item + summary text. */
export interface WikipediaPage {
  title: string;
  lang: string;
  /** The article's Wikidata item QID, when the page has one. */
  qid?: string;
  extract?: string;
  coordinates?: { lat: number; lng: number };
}

// ── Injectable network boundary ────────────────────────────────────────────────

export interface UrlExtractorDeps {
  /** Fetch and return a single Wikidata entity by QID (REST, not SPARQL). */
  fetchWikidataEntity(qid: string): Promise<WikidataEntity>;
  /** Resolve a Wikipedia article to its Wikidata item + summary. */
  fetchWikipediaPage(lang: string, title: string): Promise<WikipediaPage>;
}

// ── Statement → field vocabulary (aligned with culture-scrape hydration) ───────

/** Properties whose object QID becomes a suggested relationship, with a label. */
const RELATIONSHIP_PROPERTIES: Record<string, string> = {
  P279: "subclass-of", // parent class
  P31: "instance-of",
  P144: "based-on", // → derived_from (genetic linker)
  P737: "influenced-by",
  P17: "country",
  P276: "location",
  P495: "country-of-origin",
  P361: "part-of",
  P527: "has-part",
  P155: "follows",
  P156: "followed-by",
};

/** Properties that carry a start year (inception / birth). */
const START_YEAR_PROPERTIES = ["P571", "P569"]; // inception, date of birth
/** Properties that carry an end year (dissolved / death). */
const END_YEAR_PROPERTIES = ["P576", "P570"]; // dissolved/abolished, date of death

function firstClaim(
  entity: WikidataEntity,
  property: string,
): WikidataClaim | undefined {
  const claims = entity.claims?.[property];
  return claims && claims.length > 0 ? claims[0] : undefined;
}

function snakValue(claim: WikidataClaim | undefined): WikidataSnakValue | undefined {
  return claim?.mainsnak?.datavalue?.value;
}

/**
 * Parse a Wikidata `time` string (`+1979-01-01T00:00:00Z`, `-0044-...` for BCE)
 * into a signed year, or `null` when unparseable.
 */
export function parseWikidataYear(time: string | undefined): number | null {
  if (!time) return null;
  const match = time.match(/^([+-])(\d{1,})-/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const year = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year)) return null;
  return sign * year;
}

function pickLabel(
  map: Record<string, WikidataMonolingual> | undefined,
  preferred = "en",
): string | undefined {
  if (!map) return undefined;
  if (map[preferred]?.value) return map[preferred].value;
  const first = Object.values(map)[0];
  return first?.value;
}

/**
 * Map a fetched Wikidata entity's statements into an {@link EntityDraft}. Pure —
 * no network. `sourceUrl` and `kind` are supplied by the caller (Wikidata vs
 * Wikipedia entry point). `labelHints` optionally names target QIDs so
 * relationships can be shown with a human label instead of a bare QID.
 */
export function draftFromWikidataEntity(
  entity: WikidataEntity,
  opts: {
    kind: SourceKind;
    sourceUrl: string;
    /** Override name (e.g. the Wikipedia title) when the label is missing. */
    fallbackName?: string;
    /** Override description/extract (e.g. from the Wikipedia summary). */
    descriptionOverride?: string;
    labelHints?: Record<string, string>;
  },
): EntityDraft {
  const name = pickLabel(entity.labels) ?? opts.fallbackName ?? entity.id;
  // A verbatim label is high-confidence; a Wikipedia-title fallback less so.
  const nameConfidence = pickLabel(entity.labels) ? 0.98 : opts.fallbackName ? 0.8 : 0.5;

  const draft: EntityDraft = {
    kind: opts.kind,
    wikidataQid: entity.id,
    sourceUrl: opts.sourceUrl,
    name: { value: name, confidence: nameConfidence },
    relationships: [],
    aiGenerated: true,
    autoDerived: true,
  };

  const description = opts.descriptionOverride ?? pickLabel(entity.descriptions);
  if (description) {
    draft.description = {
      value: description,
      confidence: opts.descriptionOverride ? 0.85 : 0.8,
    };
  }

  // Coordinates — P625 globecoordinate.
  const coord = snakValue(firstClaim(entity, "P625"));
  if (
    coord &&
    typeof coord.latitude === "number" &&
    typeof coord.longitude === "number"
  ) {
    draft.coordinates = {
      value: { lat: coord.latitude, lng: coord.longitude },
      confidence: 0.9,
    };
  }

  // Dates — first available start/end property.
  for (const prop of START_YEAR_PROPERTIES) {
    const year = parseWikidataYear(snakValue(firstClaim(entity, prop))?.time);
    if (year !== null) {
      draft.timePeriodStart = { value: year, confidence: 0.85 };
      break;
    }
  }
  for (const prop of END_YEAR_PROPERTIES) {
    const year = parseWikidataYear(snakValue(firstClaim(entity, prop))?.time);
    if (year !== null) {
      draft.timePeriodEnd = { value: year, confidence: 0.85 };
      break;
    }
  }

  // Relationships — every mapped property, in declaration order, deduped by
  // (property, targetQid).
  const seen = new Set<string>();
  for (const [property, label] of Object.entries(RELATIONSHIP_PROPERTIES)) {
    const claims = entity.claims?.[property] ?? [];
    for (const claim of claims) {
      const targetQid = snakValue(claim)?.id;
      if (!targetQid || !QID_RE.test(targetQid)) continue;
      const key = `${property}:${targetQid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      draft.relationships.push({
        type: label,
        property,
        targetQid,
        targetLabel: opts.labelHints?.[targetQid] ?? targetQid,
        confidence: 0.75,
      });
    }
  }

  return draft;
}

// ── Orchestration ──────────────────────────────────────────────────────────────

const WIKIDATA_ENTITY_URL = (qid: string) =>
  `https://www.wikidata.org/wiki/${qid}`;
const WIKIPEDIA_ARTICLE_URL = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/**
 * Resolve a pasted URL into an {@link EntityDraft}. For a Wikipedia URL we first
 * resolve the article to its Wikidata item, then extract from that item (falling
 * back to the article title/summary when the page has no Wikidata item).
 *
 * @throws {UrlExtractionError} when the URL is unrecognized or resolves to no entity.
 */
export async function extractDraftFromUrl(
  rawUrl: string,
  deps: UrlExtractorDeps,
): Promise<EntityDraft> {
  const parsed = parseSourceUrl(rawUrl);

  if (parsed.kind === "wikidata") {
    const entity = await deps.fetchWikidataEntity(parsed.qid!);
    return draftFromWikidataEntity(entity, {
      kind: "wikidata",
      sourceUrl: WIKIDATA_ENTITY_URL(parsed.qid!),
    });
  }

  // Wikipedia: resolve article → Wikidata item.
  const page = await deps.fetchWikipediaPage(parsed.lang!, parsed.title!);
  const sourceUrl = WIKIPEDIA_ARTICLE_URL(parsed.lang!, parsed.title!);

  if (page.qid) {
    const entity = await deps.fetchWikidataEntity(page.qid);
    return draftFromWikidataEntity(entity, {
      kind: "wikipedia",
      sourceUrl,
      fallbackName: page.title,
      descriptionOverride: page.extract,
    });
  }

  // No Wikidata item — synthesize a minimal draft from the summary alone.
  const draft: EntityDraft = {
    kind: "wikipedia",
    sourceUrl,
    name: { value: page.title, confidence: 0.8 },
    relationships: [],
    aiGenerated: true,
    autoDerived: true,
  };
  if (page.extract) {
    draft.description = { value: page.extract, confidence: 0.7 };
  }
  if (page.coordinates) {
    draft.coordinates = { value: page.coordinates, confidence: 0.85 };
  }
  return draft;
}

// ── Draft → contribution ────────────────────────────────────────────────────────

/**
 * Overall 1..100 contribution confidence = the mean of the present field
 * confidences (0..1) scaled to 1..100. Auto-derived drafts are always < 100 so a
 * reviewer sees they need verification.
 */
export function overallConfidence(draft: EntityDraft): number {
  const scores: number[] = [draft.name.confidence];
  if (draft.description) scores.push(draft.description.confidence);
  if (draft.coordinates) scores.push(draft.coordinates.confidence);
  if (draft.timePeriodStart) scores.push(draft.timePeriodStart.confidence);
  if (draft.timePeriodEnd) scores.push(draft.timePeriodEnd.confidence);
  for (const r of draft.relationships) scores.push(r.confidence);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.max(1, Math.min(99, Math.round(mean * 100)));
}

/**
 * Convert a draft into a `Partial<Contribution>` for the review queue. The draft
 * is flagged AI/auto-derived and always enters as a `pending` contribution — it
 * never touches the live dataset. `entityType` defaults to `civilization` (which
 * only requires `name`); a caller may override it.
 */
export function draftToContribution(
  draft: EntityDraft,
  opts: {
    entityType?: ContributionEntityType;
    contributorName?: string;
    contributorEmail?: string;
  } = {},
): Partial<Contribution> {
  const entityType = opts.entityType ?? "civilization";

  const perFieldConfidence: Record<string, number> = {
    name: draft.name.confidence,
  };
  if (draft.description) perFieldConfidence.description = draft.description.confidence;
  if (draft.coordinates) perFieldConfidence.coordinates = draft.coordinates.confidence;
  if (draft.timePeriodStart)
    perFieldConfidence.timePeriodStart = draft.timePeriodStart.confidence;
  if (draft.timePeriodEnd)
    perFieldConfidence.timePeriodEnd = draft.timePeriodEnd.confidence;

  const entityData: Record<string, unknown> = {
    name: draft.name.value,
    source: "auto-derived",
    aiGenerated: true,
    autoDerived: true,
    provenanceKind: draft.kind,
    wikidataQid: draft.wikidataQid,
    sourceUrl: draft.sourceUrl,
    relationships: draft.relationships,
    perFieldConfidence,
  };
  if (draft.description) entityData.description = draft.description.value;
  if (draft.coordinates) entityData.coordinates = draft.coordinates.value;
  if (draft.timePeriodStart) entityData.timePeriodStart = draft.timePeriodStart.value;
  if (draft.timePeriodEnd) entityData.timePeriodEnd = draft.timePeriodEnd.value;

  return {
    entityType,
    action: "add",
    entityData,
    sources: [
      {
        title:
          draft.kind === "wikidata"
            ? `Wikidata ${draft.wikidataQid ?? ""}`.trim()
            : `Wikipedia: ${draft.name.value}`,
        url: draft.sourceUrl,
      },
    ],
    confidence: overallConfidence(draft),
    contributorName: opts.contributorName,
    contributorEmail: opts.contributorEmail,
    notes: "Auto-derived draft from a pasted URL — review before promoting.",
  };
}

// ── Default (live) network implementation ───────────────────────────────────────

const USER_AGENT = "pinakes/1.0 (url-extractor; +https://pinakes.local)";

/** Live deps hitting the real Wikidata/Wikipedia REST APIs (no SPARQL). */
export const liveDeps: UrlExtractorDeps = {
  async fetchWikidataEntity(qid: string): Promise<WikidataEntity> {
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      throw new UrlExtractionError(`Wikidata returned ${res.status} for ${qid}`);
    }
    const data = (await res.json()) as WikidataEntityData;
    const entity = data.entities?.[qid];
    if (!entity) throw new UrlExtractionError(`Wikidata entity ${qid} not found`);
    return entity;
  },
  async fetchWikipediaPage(lang: string, title: string): Promise<WikipediaPage> {
    // REST summary endpoint carries the wikibase_item + extract + coordinates.
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_"),
    )}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      throw new UrlExtractionError(`Wikipedia returned ${res.status} for ${title}`);
    }
    const data = (await res.json()) as {
      title?: string;
      extract?: string;
      wikibase_item?: string;
      coordinates?: { lat: number; lon: number };
    };
    return {
      title: data.title ?? title,
      lang,
      qid: data.wikibase_item,
      extract: data.extract,
      coordinates: data.coordinates
        ? { lat: data.coordinates.lat, lng: data.coordinates.lon }
        : undefined,
    };
  },
};
