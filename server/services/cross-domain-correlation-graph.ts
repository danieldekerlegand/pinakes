/**
 * Graph-backed cross-domain correlation (US-007).
 *
 * The first correlation migrated off the bespoke in-memory TSV joins in
 * cross-domain-correlation.ts and onto the shared culture-scrape graph: instead
 * of loading each domain's entities from `TsvStorage`, this path loads them from
 * Neo4j via a Cypher `MATCH (n:<Label>)` query (graph-store.getNodesByLabel) and
 * projects the node properties into the same {@link DomainEntity} shape. The
 * scoring itself is the *identical* pure code both paths share
 * (`scoreCorrelations` + `rankCorrelations`), so on a shared fixture the two
 * paths produce bit-for-bit identical results — that is the parity guarantee.
 *
 * It is **feature-flagged off by default** (`CORRELATION_GRAPH_ENABLED`) and
 * degrades cleanly: when the flag is off, a domain has no graph `:LABEL`, or
 * Neo4j is unreachable, the caller's in-memory fallback runs instead. See
 * docs/culturescrape-integration.md.
 */
import {
  scoreCorrelations,
  rankCorrelations,
  type DomainType,
  type RelationshipType,
  type CorrelationResult,
  type DomainEntity,
} from "./cross-domain-correlation";
import * as graphStore from "./graph-store";
import { GraphUnavailableError, type GraphNode } from "./graph-store";

/**
 * The correlation domains that exist as node `:LABEL`s in the shared graph, per
 * the canonical schema (shared/canonical-schema.json). `music` and `haplogroup`
 * are Pinakes-only domains with no graph node type, so a query touching
 * them is not graph-eligible and always uses the in-memory path.
 */
export const DOMAIN_LABELS: Partial<Record<DomainType, string>> = {
  language: "Language",
  cuisine: "Cuisine",
  religion: "Religion",
  civilization: "Culture",
};

/** The `:LABEL` for a domain, or `null` when the domain is not in the graph. */
export function graphDomainLabel(domain: DomainType): string | null {
  return DOMAIN_LABELS[domain] ?? null;
}

/** True when both domains map to a graph `:LABEL` (so a graph query is possible). */
export function isGraphEligible(domainA: DomainType, domainB: DomainType): boolean {
  return graphDomainLabel(domainA) !== null && graphDomainLabel(domainB) !== null;
}

/**
 * Whether the graph-backed correlation path is enabled. Opt-in via
 * `CORRELATION_GRAPH_ENABLED` (true/1/yes/on); off by default so the app keeps
 * serving the in-memory path out of the box while the graph stack is optional.
 */
export function isGraphCorrelationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CORRELATION_GRAPH_ENABLED;
  return Boolean(raw && /^(true|1|yes|on)$/i.test(raw.trim()));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Project a Neo4j node into the domain-agnostic {@link DomainEntity} the scoring
 * functions consume. The node's `pinakes_id` (the alias back to the source
 * row) is the entity id when present — so a graph-loaded entity carries the same
 * id as its in-memory counterpart — else the csid. Coordinates come from the
 * canonical `lat`/`lon` dimensions; associated languages / region from the
 * matching properties when the node carries them.
 */
export function graphNodeToDomainEntity(
  node: GraphNode,
  domain: DomainType,
): DomainEntity {
  const p = node.properties;
  const id = nonEmptyString(p.pinakes_id) ?? node.csid;
  const lat = finiteNumber(p.lat);
  const lon = finiteNumber(p.lon);
  return {
    id,
    name: node.name,
    domain,
    languageIds: stringArray(p.associated_language_ids),
    region: nonEmptyString(p.region),
    coordinates: lat !== null && lon !== null ? { lat, lng: lon } : null,
    timeStart: finiteNumber(p.time_start),
    timeEnd: finiteNumber(p.time_end),
  };
}

/** Injectable dependencies so the path is unit-testable without a live Neo4j. */
export interface GraphCorrelationDeps {
  /** Load every node of a `:LABEL` (default: graph-store.getNodesByLabel). */
  loadNodesByLabel?: (label: string) => Promise<GraphNode[]>;
  /** Year used to close open-ended spans; fixed in tests for determinism. */
  nowYear?: number;
}

async function loadDomainFromGraph(
  domain: DomainType,
  deps: GraphCorrelationDeps,
): Promise<DomainEntity[]> {
  const label = graphDomainLabel(domain);
  if (!label) {
    throw new GraphUnavailableError(`domain "${domain}" has no graph label`);
  }
  const load = deps.loadNodesByLabel ?? graphStore.getNodesByLabel;
  const nodes = await load(label);
  return nodes.map((node) => graphNodeToDomainEntity(node, domain));
}

/**
 * Run a cross-domain correlation entirely against the shared graph: load both
 * domains from Neo4j and score them with the shared pure functions.
 * @throws {GraphUnavailableError} when a domain has no graph label or Neo4j is
 *   unreachable — the caller degrades to the in-memory path.
 */
export async function correlateViaGraph(
  domainA: DomainType,
  domainB: DomainType,
  relationshipType: RelationshipType,
  deps: GraphCorrelationDeps = {},
): Promise<CorrelationResult> {
  const [entitiesA, entitiesB] = await Promise.all([
    loadDomainFromGraph(domainA, deps),
    loadDomainFromGraph(domainB, deps),
  ]);
  const correlations = scoreCorrelations(
    relationshipType,
    entitiesA,
    entitiesB,
    deps.nowYear ?? new Date().getFullYear(),
  );
  return rankCorrelations(domainA, domainB, relationshipType, correlations);
}

/** Which path produced a correlation result. */
export type CorrelationSource = "graph" | "memory";

/**
 * Serve a correlation from the graph when it is enabled, eligible, and reachable;
 * otherwise (and on any {@link GraphUnavailableError}) run `fallback` — the
 * in-memory TSV path. This is the single decision point the route calls, so the
 * feature flag and graceful-degradation live in one tested place.
 */
export async function correlateWithGraphFallback(
  domainA: DomainType,
  domainB: DomainType,
  relationshipType: RelationshipType,
  fallback: () => Promise<CorrelationResult>,
  deps: GraphCorrelationDeps = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ result: CorrelationResult; source: CorrelationSource }> {
  if (!isGraphCorrelationEnabled(env) || !isGraphEligible(domainA, domainB)) {
    return { result: await fallback(), source: "memory" };
  }
  try {
    const result = await correlateViaGraph(domainA, domainB, relationshipType, deps);
    return { result, source: "graph" };
  } catch (error) {
    if (error instanceof GraphUnavailableError) {
      return { result: await fallback(), source: "memory" };
    }
    throw error;
  }
}
