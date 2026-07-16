/**
 * Progressive summary/detail contract (US-004, tasklist 13 platform-infra).
 *
 * Pinakes's entity list endpoints historically return **fully hydrated**
 * records (every field of every row), so a client that only needs a name plus a
 * couple of badge fields to render a list/card still pays for the whole payload
 * (descriptions, pantheons, sacred texts, diffusion paths, …). This module
 * declares, per domain, the **lightweight summary** projection — the minimal
 * field set needed to render a collapsed card — and a pure `summarize` +
 * pagination core that the `/api/summaries/*` routes and their tests share.
 *
 * The summary is always a strict **subset** of the detail record (the full
 * entity returned by the existing `/api/<domain>/:id` endpoints), so "fetch
 * summaries first, hydrate detail on demand" is a lossless progression: no
 * summary field is absent from the detail shape. Human-readable contract table:
 * docs/progressive-loading.md.
 *
 * This module is intentionally **pure** — it imports no Express and no storage —
 * so the projection + pagination is trivially unit-tested against fixture rows.
 */

/** A raw (fully-hydrated) entity record — the shape a detail endpoint returns. */
export type EntityRecord = Record<string, unknown>;

/** A projected lightweight record: the contract's fields that are present. */
export type EntitySummary = Record<string, unknown>;

/** The summary/detail contract for one domain. */
export interface SummaryContract {
  /**
   * The existing detail-on-demand endpoint template (`:id` placeholder). The
   * summary list points clients here to hydrate a single entity's full record.
   */
  detailEndpoint: string;
  /**
   * The lightweight summary fields, in display order. Always a subset of the
   * detail record's keys, and always led by `id` + `name` so every summary is
   * renderable and hydratable.
   */
  fields: string[];
}

/**
 * The per-domain summary contracts. Each `fields` list is the minimal set the
 * client needs to render a collapsed list/card row; everything else lives in the
 * detail record fetched lazily from `detailEndpoint`. Fields are validated to be
 * a subset of the real record by the route tests (they compare a summary against
 * the full record for the same id).
 */
export const SUMMARY_CONTRACTS = {
  languages: {
    detailEndpoint: "/api/languages/:id",
    fields: ["id", "name", "nativeName", "iso639_1", "familyId", "region", "status"],
  },
  religions: {
    detailEndpoint: "/api/religions/:id",
    fields: ["id", "name", "nativeName", "religionType", "originRegion", "timeOrigin", "timeEnd"],
  },
  battles: {
    detailEndpoint: "/api/battles/:id",
    fields: ["id", "name", "date", "warName", "outcome"],
  },
  "culture-profiles": {
    detailEndpoint: "/api/culture-profiles/:id",
    fields: [
      "id",
      "name",
      "region",
      "timePeriodStart",
      "timePeriodEnd",
      "socialOrganization",
      "subsistenceType",
      "urbanismLevel",
      "technologyLevel",
    ],
  },
  cuisines: {
    detailEndpoint: "/api/cuisines/:id",
    fields: ["id", "name", "nativeName", "region", "timeOrigin", "timeEnd"],
  },
  "trade-goods": {
    detailEndpoint: "/api/trade-goods/:id",
    fields: ["id", "name", "category", "originRegion", "timePeriod"],
  },
  innovations: {
    detailEndpoint: "/api/innovations/:id",
    fields: ["id", "name", "category", "yearInvented", "regionOfOrigin"],
  },
} as const satisfies Record<string, SummaryContract>;

/** A domain key with a declared summary contract. */
export type SummaryDomain = keyof typeof SUMMARY_CONTRACTS;

/** Every domain that has a summary contract, in declaration order. */
export function summaryDomains(): SummaryDomain[] {
  return Object.keys(SUMMARY_CONTRACTS) as SummaryDomain[];
}

/** Narrowing guard: does `value` name a domain with a summary contract? */
export function isSummaryDomain(value: string): value is SummaryDomain {
  return Object.prototype.hasOwnProperty.call(SUMMARY_CONTRACTS, value);
}

/** The contract (detail endpoint + fields) for one domain. */
export function summaryContract(domain: SummaryDomain): SummaryContract {
  return SUMMARY_CONTRACTS[domain];
}

/** The summary fields for one domain (a fresh copy, safe to mutate). */
export function summaryFields(domain: SummaryDomain): string[] {
  return [...SUMMARY_CONTRACTS[domain].fields];
}

/**
 * Project one record down to its domain summary: the contract fields that are
 * actually present on the record, in contract order. A contract field missing
 * from the record is simply omitted (never emitted as `undefined`), so the
 * summary shape never invents keys the detail record lacks.
 */
export function summarizeEntity(domain: SummaryDomain, record: EntityRecord): EntitySummary {
  const summary: EntitySummary = {};
  for (const field of SUMMARY_CONTRACTS[domain].fields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      summary[field] = record[field];
    }
  }
  return summary;
}

/** A bounded page of items plus the metadata a client needs to page further. */
export interface Page<T> {
  items: T[];
  /** total items before pagination. */
  total: number;
  /** items in this page (`items.length`). */
  returned: number;
  /** applied offset (clamped to `[0, total]`). */
  offset: number;
  /** applied limit, or `null` when unbounded (whole remainder returned). */
  limit: number | null;
  /** whether items remain after this page. */
  hasMore: boolean;
}

/** Coerce a possibly-undefined/NaN offset to a non-negative integer. */
function clampOffset(offset: number | undefined, total: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), total);
}

/** Coerce a possibly-undefined limit to a non-negative integer or `null`. */
function normalizeLimit(limit: number | null | undefined): number | null {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) return null;
  return Math.max(0, Math.floor(limit));
}

/**
 * Slice `items` by `offset`/`limit` and report page metadata. A missing/NaN
 * offset means 0; a missing/NaN limit means "no limit" (whole remainder). Pure
 * and total: any input yields a valid, bounded page.
 */
export function paginate<T>(
  items: readonly T[],
  opts: { offset?: number; limit?: number | null } = {},
): Page<T> {
  const total = items.length;
  const offset = clampOffset(opts.offset, total);
  const limit = normalizeLimit(opts.limit);
  const slice = limit === null ? items.slice(offset) : items.slice(offset, offset + limit);
  return {
    items: slice,
    total,
    returned: slice.length,
    offset,
    limit,
    hasMore: offset + slice.length < total,
  };
}

/** The `/api/summaries/:domain` response body. */
export interface SummaryListResult {
  domain: SummaryDomain;
  /** the summary fields present in every element of `summaries`. */
  fields: string[];
  /** where to hydrate a single entity's full record. */
  detailEndpoint: string;
  /** the lightweight records for this page. */
  summaries: EntitySummary[];
  total: number;
  returned: number;
  offset: number;
  limit: number | null;
  hasMore: boolean;
}

/**
 * Paginate `records`, then project each to its domain summary. This is the whole
 * server-side body of `GET /api/summaries/:domain` (the route only fetches the
 * records and parses query params).
 */
export function summarizeList(
  domain: SummaryDomain,
  records: readonly EntityRecord[],
  opts: { offset?: number; limit?: number | null } = {},
): SummaryListResult {
  const page = paginate(records, opts);
  return {
    domain,
    fields: summaryFields(domain),
    detailEndpoint: SUMMARY_CONTRACTS[domain].detailEndpoint,
    summaries: page.items.map((record) => summarizeEntity(domain, record)),
    total: page.total,
    returned: page.returned,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
  };
}
