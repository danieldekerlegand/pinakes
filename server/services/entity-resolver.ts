/**
 * Stable, citable per-entity URL resolver (US-009).
 *
 * Every major entity type gets ONE permanent canonical URL — `/entity/:domain/:id` —
 * independent of whatever view happens to render it. This module is the pure
 * system-of-record for that scheme: it declares the entity-domain registry and the
 * id ⇄ canonical-path mapping, with **no** storage/express/fs dependency, so route
 * resolution is unit-testable directly.
 *
 * The registry is deliberately app-native (the domains a URL can resolve to a real
 * record in this app — mirroring the citation-export/summaries domain naming), not the
 * pinakes-engine canonical node vocabulary. Each domain also carries the canonical
 * graph `entityType` (for `cs:<type>:<id>` stable ids) and whether it is `citable`
 * (has a `/api/citations` fetcher, US-008).
 */

/** The client route stem every canonical entity URL shares. */
export const CANONICAL_ENTITY_PREFIX = "/entity";

/** The canonical path template, for self-documenting contracts. */
export const CANONICAL_PATH_TEMPLATE = `${CANONICAL_ENTITY_PREFIX}/:domain/:id`;

/** One entity domain's routing metadata. */
export interface EntityDomainSpec {
  /** Human label (e.g. "Civilization"). */
  readonly label: string;
  /** Canonical graph node type for the `cs:<type>:<id>` stable id (US-009 / graph-resolver). */
  readonly entityType: string;
  /** True when `/api/citations/:domain/:id` can cite this domain (US-008). */
  readonly citable: boolean;
  /**
   * The `/api/citations` domain segment when citable — this differs from the entity
   * domain (citations use the plural `culture-profiles`/`deities`/…). Absent ⇒ not citable.
   */
  readonly citationDomain?: string;
  /**
   * Optional richer, id-specific view path (a real detail page). When absent the
   * landing page falls back to the generic explorer link — existing view-state
   * deep-linking via `useShareableState` is unaffected either way.
   */
  readonly viewPath?: (id: string) => string;
}

/**
 * The entity domains that own a canonical URL. Keys are the URL `:domain` segment
 * (kebab-case, matching the citation/summary domains where they overlap).
 */
export const ENTITY_DOMAINS = {
  language: { label: "Language", entityType: "language", citable: false },
  "language-family": { label: "Language Family", entityType: "language-family", citable: false },
  civilization: { label: "Civilization", entityType: "culture", citable: true, citationDomain: "civilizations" },
  "culture-profile": {
    label: "Culture Profile",
    entityType: "culture",
    citable: true,
    citationDomain: "culture-profiles",
    viewPath: (id: string) => `/culture-profile/${encodeURIComponent(id)}/report`,
  },
  "archaeological-site": {
    label: "Archaeological Site",
    entityType: "place",
    citable: true,
    citationDomain: "archaeological-sites",
  },
  deity: { label: "Deity", entityType: "deity", citable: true, citationDomain: "deities" },
  religion: { label: "Religion", entityType: "religion", citable: false },
  cuisine: { label: "Cuisine", entityType: "cuisine", citable: false },
  "trade-good": { label: "Trade Good", entityType: "trade-good", citable: false },
  "writing-system": { label: "Writing System", entityType: "writing-system", citable: false },
  battle: { label: "Battle", entityType: "battle", citable: false },
  "urheimat-hypothesis": { label: "Urheimat Hypothesis", entityType: "urheimat-hypothesis", citable: false },
} as const satisfies Record<string, EntityDomainSpec>;

/** A supported entity-domain key. */
export type EntityDomain = keyof typeof ENTITY_DOMAINS;

/** All supported entity domains, in registry order. */
export function entityDomains(): EntityDomain[] {
  return Object.keys(ENTITY_DOMAINS) as EntityDomain[];
}

/** Narrowing guard: is `value` a known entity domain? */
export function isEntityDomain(value: unknown): value is EntityDomain {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ENTITY_DOMAINS, value);
}

/** The registry spec for a domain. */
export function entityDomainSpec(domain: EntityDomain): EntityDomainSpec {
  return ENTITY_DOMAINS[domain];
}

/**
 * The canonical, permanent path for an entity: `/entity/<domain>/<id>`. The id is
 * URL-encoded so ids containing reserved chars still round-trip through
 * {@link parseCanonicalEntityPath}.
 */
export function canonicalEntityPath(domain: EntityDomain, id: string): string {
  return `${CANONICAL_ENTITY_PREFIX}/${domain}/${encodeURIComponent(id)}`;
}

/** The JSON resolver endpoint for an entity. */
export function entityApiPath(domain: EntityDomain, id: string): string {
  return `/api/entity/${domain}/${encodeURIComponent(id)}`;
}

/**
 * The stable `cs:<entityType>:<id>` reference id (mirrors `graph-resolver.mintCsid`
 * / `collections.stableEntityId`), keyed on the domain's canonical graph node type.
 */
export function stableEntityId(domain: EntityDomain, id: string): string {
  return `cs:${ENTITY_DOMAINS[domain].entityType}:${id}`;
}

/**
 * Parse a canonical entity path back to `{ domain, id }`, or `null` when it is not a
 * well-formed `/entity/<known-domain>/<id>` path (unknown domain, wrong shape, or an
 * empty id → null so callers can 404 gracefully). A leading origin is tolerated.
 */
export function parseCanonicalEntityPath(path: string): { domain: EntityDomain; id: string } | null {
  if (typeof path !== "string" || path.length === 0) return null;
  // Strip an optional scheme+host, then the query/hash.
  let rest = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  rest = rest.split(/[?#]/)[0];
  const match = rest.match(/^\/entity\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  const domain = match[1];
  if (!isEntityDomain(domain)) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    id = match[2];
  }
  if (id.length === 0) return null;
  return { domain, id };
}

/** The normalized descriptor a resolver returns for a known entity. */
export interface ResolvedEntity {
  readonly domain: EntityDomain;
  readonly id: string;
  readonly name: string;
  readonly entityType: string;
  readonly label: string;
  readonly stableId: string;
  /** Site-relative canonical path (always present). */
  readonly canonicalPath: string;
  /** Absolute canonical URL when an origin is supplied, else the relative path. */
  readonly canonicalUrl: string;
  readonly apiPath: string;
  readonly citable: boolean;
  /** The `/api/citations` domain segment when citable (plural), else `null`. */
  readonly citationDomain: string | null;
  /** Richer id-specific view when the domain has one, else `null`. */
  readonly viewPath: string | null;
  readonly region: string | null;
  readonly year: number | null;
}

/** The minimal record shape a domain fetcher yields (before URL/id normalization). */
export interface EntityRecordLite {
  readonly id: string;
  readonly name: string;
  readonly region?: string | null;
  readonly year?: number | null;
}

/**
 * Build the {@link ResolvedEntity} descriptor for a fetched record. `origin`
 * (e.g. `https://host`) makes `canonicalUrl` absolute (for citations / sharing);
 * omit it for a relative path.
 */
export function describeEntity(
  domain: EntityDomain,
  record: EntityRecordLite,
  origin = "",
): ResolvedEntity {
  const spec: EntityDomainSpec = ENTITY_DOMAINS[domain];
  const canonicalPath = canonicalEntityPath(domain, record.id);
  return {
    domain,
    id: record.id,
    name: record.name,
    entityType: spec.entityType,
    label: spec.label,
    stableId: stableEntityId(domain, record.id),
    canonicalPath,
    canonicalUrl: origin ? `${origin}${canonicalPath}` : canonicalPath,
    apiPath: entityApiPath(domain, record.id),
    citable: spec.citable,
    citationDomain: spec.citationDomain ?? null,
    viewPath: spec.viewPath ? spec.viewPath(record.id) : null,
    region: record.region ?? null,
    year: record.year ?? null,
  };
}
