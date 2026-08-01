/**
 * Neo4j TypeScript data-access layer for the shared culture-scrape graph.
 *
 * pinakes queries the shared correlation store two ways (see
 * docs/culturescrape-integration.md): the FastAPI proxy for search/Datalog, and
 * this module — the official `neo4j-driver` — for relational/graph queries
 * (node lookup, neighborhood traversal, correlation edges).
 *
 * The canonical graph schema (core/docs/data-model.md):
 *   nodes carry `csid` (primary key), one or more `:LABEL`s, `name`, temporal
 *   props (`time_start`/`time_end`) and provenance (`source`, `source_url`,
 *   `retrieved_at`, `confidence`); edges carry a data-driven `:TYPE`, an optional
 *   `weight`, and the same provenance block.
 *
 * Everything here degrades gracefully: when Neo4j is unreachable the query
 * helpers throw a typed {@link GraphUnavailableError} (so routes can answer 503)
 * and {@link isAvailable} returns `false` rather than crashing the server.
 */
import neo4j, {
  type Driver,
  type Node as Neo4jNode,
  type Relationship as Neo4jRelationship,
  type QueryResult,
} from "neo4j-driver";
import {
  filterPersonalNodes,
  isPersonalNode,
  isPersonalTierEnabled,
} from "./personal-tier";

// ── Public result types (validated at the driver boundary) ──────────────────

/** A node projected out of Neo4j into a plain, JSON-safe shape. */
export interface GraphNode {
  /** culture-scrape global id (`cs:<type>:<slug>`), the primary key. */
  csid: string;
  /** node labels (`:LABEL`), e.g. `["Dish", "CulturalArtifact"]`. */
  labels: string[];
  /** canonical display name (may be empty if the node has none). */
  name: string;
  /** all remaining node properties, Neo4j integers coerced to JS numbers. */
  properties: Record<string, unknown>;
}

/** A relationship projected out of Neo4j into a plain, JSON-safe shape. */
export interface GraphEdge {
  /** stable element id of the relationship. */
  id: string;
  /** the data-driven relationship type (`:TYPE`), e.g. `CONTEMPORARY_WITH`. */
  type: string;
  /** csid of the start node. */
  startCsid: string;
  /** csid of the end node. */
  endCsid: string;
  /** optional strength/confidence of the edge. */
  weight?: number;
  /** all remaining edge properties, Neo4j integers coerced to JS numbers. */
  properties: Record<string, unknown>;
}

/** A bounded snapshot of the graph — a set of nodes and the edges among them. */
export interface GraphSnapshot {
  /** the sampled nodes (capped by the overview limit). */
  nodes: GraphNode[];
  /** every edge whose endpoints are both in {@link GraphSnapshot.nodes}. */
  edges: GraphEdge[];
}

/** A shortest connecting path between two nodes in the graph. */
export interface GraphPath {
  /** the start node (`from` csid). */
  from: GraphNode;
  /** the end node (`to` csid). */
  to: GraphNode;
  /** every node on the path, ordered from `from` to `to` (inclusive). */
  nodes: GraphNode[];
  /** every edge on the path, ordered from `from` to `to`. */
  edges: GraphEdge[];
  /** number of hops (edges) on the path. */
  length: number;
}

/** A node plus its surrounding sub-graph out to a bounded traversal depth. */
export interface Neighborhood {
  /** the focus node the neighborhood is centered on. */
  root: GraphNode;
  /** every node reachable within `depth` hops (includes `root`). */
  nodes: GraphNode[];
  /** every edge among the returned nodes. */
  edges: GraphEdge[];
  /** the traversal depth actually used (clamped to {@link MIN_DEPTH}..{@link MAX_DEPTH}). */
  depth: number;
}

/** One correlated entity plus the relationship that links it to the focus. */
export interface Correlation {
  /** the related node. */
  node: GraphNode;
  /** the relationship type joining it to the focus node. */
  relationship: string;
  /** the edge weight, when the relationship carries one. */
  weight?: number;
}

/** Thrown by the query helpers when the graph store cannot be reached. */
export class GraphUnavailableError extends Error {
  constructor(message = "Neo4j graph store is unavailable") {
    super(message);
    this.name = "GraphUnavailableError";
  }
}

// ── Configuration (from env) ────────────────────────────────────────────────

const MIN_DEPTH = 1;
const MAX_DEPTH = 3;
/** Default and hard cap on shortest-path length (hops) for {@link findPath}. */
const DEFAULT_PATH_LENGTH = 4;
const MAX_PATH_LENGTH = 6;
/** Default and hard cap on the number of nodes an overview snapshot returns. */
const DEFAULT_OVERVIEW_LIMIT = 250;
const MAX_OVERVIEW_LIMIT = 1_000;
/** How long a positive/negative availability probe is trusted, in ms. */
const AVAILABILITY_TTL_MS = 5_000;

interface GraphStoreConfig {
  uri: string;
  user: string;
  password: string;
  database: string;
  /** per-query timeout in ms. */
  queryTimeoutMs: number;
  /** connection acquisition + establishment timeout in ms. */
  connectionTimeoutMs: number;
  maxConnectionPoolSize: number;
}

function readConfig(): GraphStoreConfig {
  return {
    uri: process.env.NEO4J_URI || "bolt://localhost:7687",
    user: process.env.NEO4J_USER || "neo4j",
    password: process.env.NEO4J_PASSWORD || "",
    database: process.env.NEO4J_DATABASE || "neo4j",
    queryTimeoutMs: Number(process.env.NEO4J_QUERY_TIMEOUT_MS) || 10_000,
    connectionTimeoutMs: Number(process.env.NEO4J_CONNECTION_TIMEOUT_MS) || 5_000,
    maxConnectionPoolSize: Number(process.env.NEO4J_MAX_POOL_SIZE) || 50,
  };
}

// ── Driver lifecycle (lazy singleton with pooling) ──────────────────────────

let driver: Driver | null = null;

function getDriver(): Driver {
  if (driver) return driver;
  const cfg = readConfig();
  driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.password), {
    maxConnectionPoolSize: cfg.maxConnectionPoolSize,
    connectionAcquisitionTimeout: cfg.connectionTimeoutMs,
    connectionTimeout: cfg.connectionTimeoutMs,
    // Fail fast rather than retrying for the lifetime of a request.
    maxTransactionRetryTime: cfg.queryTimeoutMs,
  });
  return driver;
}

/**
 * Close the driver and release its connection pool. Safe to call when no driver
 * has been created, and safe to call more than once (server shutdown hook /
 * test teardown). Also clears the availability cache.
 */
export async function closeGraphStore(): Promise<void> {
  availabilityCache = null;
  const current = driver;
  driver = null;
  if (current) {
    await current.close();
  }
}

// ── Availability probe (short-lived cache) ──────────────────────────────────

interface AvailabilityCache {
  available: boolean;
  checkedAt: number;
}

let availabilityCache: AvailabilityCache | null = null;

/**
 * Report whether the graph store is reachable, caching the result for a short
 * window so a burst of requests issues a single probe. Never throws.
 */
export async function isAvailable(): Promise<boolean> {
  const now = Date.now();
  if (availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_TTL_MS) {
    return availabilityCache.available;
  }
  let available = false;
  try {
    await getDriver().verifyConnectivity();
    available = true;
  } catch {
    available = false;
  }
  availabilityCache = { available, checkedAt: now };
  return available;
}

// ── Boundary coercion helpers ───────────────────────────────────────────────

/**
 * Recursively convert Neo4j `Integer` wrappers to JS numbers so results are
 * plain JSON. Values outside the safe integer range are preserved as strings
 * rather than silently losing precision.
 */
function coerceValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (neo4j.isInt(value)) {
    const asInt = value as ReturnType<typeof neo4j.int>;
    return asInt.inSafeRange() ? asInt.toNumber() : asInt.toString();
  }
  if (Array.isArray(value)) return value.map(coerceValue);
  return value;
}

function coerceProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = coerceValue(value);
  }
  return out;
}

/** Project a raw Neo4j node into a {@link GraphNode}, splitting out csid/name. */
function projectNode(node: Neo4jNode): GraphNode {
  const props = coerceProperties(node.properties as Record<string, unknown>);
  const csid = typeof props.csid === "string" ? props.csid : node.elementId;
  const name = typeof props.name === "string" ? props.name : "";
  const { csid: _csid, name: _name, ...rest } = props;
  return {
    csid,
    labels: [...node.labels],
    name,
    properties: rest,
  };
}

/** Project a raw Neo4j relationship into a {@link GraphEdge}. */
function projectEdge(
  rel: Neo4jRelationship,
  csidByElementId: Map<string, string>,
): GraphEdge {
  const props = coerceProperties(rel.properties as Record<string, unknown>);
  const weight = typeof props.weight === "number" ? props.weight : undefined;
  const { weight: _weight, ...rest } = props;
  return {
    id: rel.elementId,
    type: rel.type,
    startCsid: csidByElementId.get(rel.startNodeElementId) ?? rel.startNodeElementId,
    endCsid: csidByElementId.get(rel.endNodeElementId) ?? rel.endNodeElementId,
    ...(weight !== undefined ? { weight } : {}),
    properties: rest,
  };
}

/** Run a read query in a session, mapping driver failures to typed errors. */
async function runRead(
  cypher: string,
  params: Record<string, unknown>,
): Promise<QueryResult> {
  // Fast-fail when the graph is unreachable. Without this a read waits out the
  // driver's full connection/retry window (~15s with the default timeouts)
  // before surfacing an error, so a UI backed by a read (e.g. the explorer's
  // shared-graph adapter) hangs on "Loading…" instead of degrading promptly.
  // The probe is cached (AVAILABILITY_TTL_MS), so a burst of reads shares one
  // connectivity check.
  if (!(await isAvailable())) {
    throw new GraphUnavailableError();
  }
  const cfg = readConfig();
  const session = getDriver().session({
    database: cfg.database,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    return await session.executeRead((tx) => tx.run(cypher, params), {
      timeout: cfg.queryTimeoutMs,
    });
  } catch (err) {
    // A failed query invalidates the cached "available" verdict.
    availabilityCache = null;
    throw new GraphUnavailableError(
      err instanceof Error ? err.message : "Neo4j query failed",
    );
  } finally {
    await session.close();
  }
}

// ── Public queries ──────────────────────────────────────────────────────────

/**
 * Drop personal-tier nodes and any edge touching one, unless the
 * `PERSONAL_TIER_ENABLED` flag is set. The proxy surfaces
 * personal media facts only when the operator opts in; by default they stay
 * local-only. A no-op when the flag is on or the graph holds no personal node.
 */
function gatePersonal(nodes: GraphNode[], edges: GraphEdge[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const enabled = isPersonalTierEnabled();
  const keptNodes = filterPersonalNodes(nodes, enabled);
  if (keptNodes.length === nodes.length) return { nodes, edges };
  const keptCsids = new Set(keptNodes.map((n) => n.csid));
  const keptEdges = edges.filter(
    (e) => keptCsids.has(e.startCsid) && keptCsids.has(e.endCsid),
  );
  return { nodes: keptNodes, edges: keptEdges };
}

/**
 * Look up a single node by its `csid`. Returns `null` when no such node exists,
 * or when it is a personal-tier node and the tier is not enabled (the proxy does
 * not surface a personal file by direct csid lookup either).
 * @throws {GraphUnavailableError} when Neo4j cannot be reached.
 */
export async function getNode(csid: string): Promise<GraphNode | null> {
  const result = await runRead(
    "MATCH (n {csid: $csid}) RETURN n LIMIT 1",
    { csid },
  );
  const record = result.records[0];
  if (!record) return null;
  const node = projectNode(record.get("n") as Neo4jNode);
  if (!isPersonalTierEnabled() && isPersonalNode(node)) return null;
  return node;
}

/**
 * Return every node carrying the given `:LABEL` (e.g. `Language`, `Culture`),
 * projected into plain {@link GraphNode}s. Powers the graph-backed cross-domain
 * correlation (US-007), which loads a whole domain's entities and scores them
 * with the same pure functions the in-memory path uses.
 *
 * A `:LABEL` cannot be a Cypher parameter, so the label is validated against the
 * schema-safe identifier charset before it is inlined — it can never inject.
 * @throws {GraphUnavailableError} when Neo4j cannot be reached, or the label is
 *   not a valid identifier.
 */
export async function getNodesByLabel(label: string): Promise<GraphNode[]> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
    throw new GraphUnavailableError(`invalid node label: ${label}`);
  }
  const result = await runRead(`MATCH (n:${label}) RETURN n`, {});
  const nodes = result.records.map((record) =>
    projectNode(record.get("n") as Neo4jNode),
  );
  return filterPersonalNodes(nodes, isPersonalTierEnabled());
}

/** Clamp a requested overview node cap into the supported 1..MAX range. */
export function clampOverviewLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_OVERVIEW_LIMIT;
  return Math.min(MAX_OVERVIEW_LIMIT, Math.max(1, Math.trunc(limit)));
}

/**
 * Fetch a bounded snapshot of the graph — the first `limit` nodes plus every
 * edge whose endpoints both fall inside that set. Powers the shared-graph
 * dataset in the UnifiedExplorer, which needs a node/edge payload (not a
 * node-centred neighborhood). Returns an empty snapshot for an empty graph.
 * @throws {GraphUnavailableError} when Neo4j cannot be reached.
 */
export async function getGraphOverview(
  limit = DEFAULT_OVERVIEW_LIMIT,
): Promise<GraphSnapshot> {
  const clamped = clampOverviewLimit(limit);
  const cypher = `
    MATCH (n)
    WITH n LIMIT $limit
    WITH collect(n) AS ns
    UNWIND ns AS n
    OPTIONAL MATCH (n)-[r]->(m)
    WHERE m IN ns
    WITH ns, collect(DISTINCT r) AS rs
    RETURN ns AS nodes, rs AS rels
  `;
  const result = await runRead(cypher, { limit: neo4j.int(clamped) });
  return buildSnapshot(result);
}

function buildSnapshot(result: QueryResult): GraphSnapshot {
  const record = result.records[0];
  if (!record) return { nodes: [], edges: [] };

  const rawNodes = ((record.get("nodes") as Neo4jNode[]) ?? []).filter(Boolean);
  const nodeByElementId = new Map<string, Neo4jNode>();
  for (const n of rawNodes) nodeByElementId.set(n.elementId, n);

  const csidByElementId = new Map<string, string>();
  const nodes: GraphNode[] = [];
  for (const n of Array.from(nodeByElementId.values())) {
    const projected = projectNode(n);
    csidByElementId.set(n.elementId, projected.csid);
    nodes.push(projected);
  }

  const rawRels = ((record.get("rels") as Neo4jRelationship[]) ?? []).filter(
    Boolean,
  );
  const edgesById = new Map<string, GraphEdge>();
  for (const rel of rawRels) {
    if (
      nodeByElementId.has(rel.startNodeElementId) &&
      nodeByElementId.has(rel.endNodeElementId)
    ) {
      const edge = projectEdge(rel, csidByElementId);
      edgesById.set(edge.id, edge);
    }
  }

  return gatePersonal(nodes, Array.from(edgesById.values()));
}

/** Clamp a requested traversal depth into the supported 1..3 range. */
export function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return MIN_DEPTH;
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.trunc(depth)));
}

/**
 * Fetch a node's neighborhood out to `depth` hops (clamped to 1..3). Returns
 * `null` when the focus node does not exist.
 * @throws {GraphUnavailableError} when Neo4j cannot be reached.
 */
export async function getNeighborhood(
  csid: string,
  depth = 1,
): Promise<Neighborhood | null> {
  const clamped = clampDepth(depth);
  // Variable-length path with an inlined bound; the bound is validated above so
  // it is never attacker-controlled interpolation. The focus csid stays a param.
  const cypher = `
    MATCH (focus {csid: $csid})
    OPTIONAL MATCH path = (focus)-[*1..${clamped}]-(reached)
    WITH focus,
         collect(DISTINCT reached) AS reachedNodes,
         [r IN apoc.coll.flatten(collect(relationships(path))) | r] AS pathRels
    RETURN focus, reachedNodes, pathRels
  `;
  let result: QueryResult;
  try {
    result = await runRead(cypher, { csid });
  } catch (err) {
    // APOC may be absent (bulk-import graphs don't require it). Fall back to a
    // pure-Cypher traversal that returns the same shape.
    if (err instanceof GraphUnavailableError && /apoc/i.test(err.message)) {
      result = await runRead(fallbackNeighborhoodCypher(clamped), { csid });
    } else {
      throw err;
    }
  }
  return buildNeighborhood(result, clamped);
}

function fallbackNeighborhoodCypher(depth: number): string {
  return `
    MATCH (focus {csid: $csid})
    OPTIONAL MATCH (focus)-[*1..${depth}]-(reached)
    WITH focus, collect(DISTINCT reached) AS reachedNodes
    WITH focus, reachedNodes, reachedNodes + focus AS scope
    OPTIONAL MATCH (a)-[r]-(b)
    WHERE a IN scope AND b IN scope
    RETURN focus, reachedNodes, collect(DISTINCT r) AS pathRels
  `;
}

function buildNeighborhood(result: QueryResult, depth: number): Neighborhood | null {
  const record = result.records[0];
  if (!record) return null;
  const focus = record.get("focus") as Neo4jNode | null;
  if (!focus) return null;

  const rawNodes = [focus, ...((record.get("reachedNodes") as Neo4jNode[]) ?? [])];
  const nodeByElementId = new Map<string, Neo4jNode>();
  for (const n of rawNodes) {
    if (n) nodeByElementId.set(n.elementId, n);
  }

  const csidByElementId = new Map<string, string>();
  const nodes: GraphNode[] = [];
  for (const n of Array.from(nodeByElementId.values())) {
    const projected = projectNode(n);
    csidByElementId.set(n.elementId, projected.csid);
    nodes.push(projected);
  }

  const rawRels = ((record.get("pathRels") as Neo4jRelationship[]) ?? []).filter(
    Boolean,
  );
  const edgesById = new Map<string, GraphEdge>();
  for (const rel of rawRels) {
    // Keep only edges whose endpoints are both in the returned node set.
    if (
      nodeByElementId.has(rel.startNodeElementId) &&
      nodeByElementId.has(rel.endNodeElementId)
    ) {
      const edge = projectEdge(rel, csidByElementId);
      edgesById.set(edge.id, edge);
    }
  }

  const root = projectNode(focus);
  // The proxy does not surface a personal file's neighborhood by direct lookup
  // unless the tier is enabled.
  if (!isPersonalTierEnabled() && isPersonalNode(root)) return null;
  const gated = gatePersonal(nodes, Array.from(edgesById.values()));
  return {
    root,
    nodes: gated.nodes,
    edges: gated.edges,
    depth,
  };
}

/**
 * Return the entities directly correlated with a focus node. When `relationship`
 * is given, only edges of that `:TYPE` are followed (e.g. `LOCATED_IN`,
 * `DESCENDS_FROM`); otherwise every direct relationship is returned. (Pairwise
 * temporal relations — `CONTEMPORARY_WITH`/`PRECEDES`/`FOLLOWS` — are no longer
 * stored as edges; they are derived on demand by the culture-scrape Datalog
 * rules, so a query for one returns an empty array here.) Ordered by descending
 * edge weight, then name.
 * @throws {GraphUnavailableError} when Neo4j cannot be reached.
 */
export async function getCorrelations(
  csid: string,
  relationship?: string,
): Promise<Correlation[]> {
  // A relationship type cannot be a Cypher parameter; validate it against the
  // schema-safe charset before inlining so it can never inject.
  const relPattern =
    relationship && /^[A-Za-z_][A-Za-z0-9_]*$/.test(relationship)
      ? `:${relationship}`
      : "";
  if (relationship && !relPattern) {
    throw new GraphUnavailableError(
      `invalid relationship type: ${relationship}`,
    );
  }
  const cypher = `
    MATCH (focus {csid: $csid})-[r${relPattern}]-(other)
    RETURN other, type(r) AS relType, r.weight AS weight
    ORDER BY coalesce(r.weight, 0) DESC, other.name ASC
  `;
  const result = await runRead(cypher, { csid });
  const enabled = isPersonalTierEnabled();
  const correlations: Correlation[] = [];
  for (const record of result.records) {
    const node = projectNode(record.get("other") as Neo4jNode);
    // A correlated personal-tier node is not surfaced unless the tier is enabled.
    if (!enabled && isPersonalNode(node)) continue;
    const rawWeight = coerceValue(record.get("weight"));
    const weight = typeof rawWeight === "number" ? rawWeight : undefined;
    correlations.push({
      node,
      relationship: record.get("relType") as string,
      ...(weight !== undefined ? { weight } : {}),
    });
  }
  return correlations;
}

/** Clamp a requested shortest-path length into the supported 1..MAX range. */
export function clampPathLength(length: number): number {
  if (!Number.isFinite(length)) return DEFAULT_PATH_LENGTH;
  return Math.min(MAX_PATH_LENGTH, Math.max(MIN_DEPTH, Math.trunc(length)));
}

/**
 * Find the shortest connecting path between two nodes (by csid), up to
 * `maxLength` hops (clamped to 1..6). Returns `null` when either endpoint is
 * missing or no path within the bound exists — the caller distinguishes these
 * two only by first checking existence, which keeps this a single query. The
 * returned nodes/edges are ordered from `from` to `to`.
 * @throws {GraphUnavailableError} when Neo4j cannot be reached.
 */
export async function findPath(
  fromCsid: string,
  toCsid: string,
  maxLength = DEFAULT_PATH_LENGTH,
): Promise<GraphPath | null> {
  const clamped = clampPathLength(maxLength);
  // The bound is validated above so it is never attacker-controlled
  // interpolation; the csids stay parameters.
  const cypher = `
    MATCH (a {csid: $from}), (b {csid: $to})
    MATCH p = shortestPath((a)-[*1..${clamped}]-(b))
    RETURN nodes(p) AS pathNodes, relationships(p) AS pathRels
  `;
  const result = await runRead(cypher, { from: fromCsid, to: toCsid });
  return buildPath(result);
}

function buildPath(result: QueryResult): GraphPath | null {
  const record = result.records[0];
  if (!record) return null;

  const rawNodes = ((record.get("pathNodes") as Neo4jNode[]) ?? []).filter(Boolean);
  if (rawNodes.length === 0) return null;

  const csidByElementId = new Map<string, string>();
  const nodes: GraphNode[] = [];
  for (const n of rawNodes) {
    const projected = projectNode(n);
    csidByElementId.set(n.elementId, projected.csid);
    nodes.push(projected);
  }

  // A shortest path that traverses a personal-tier node is not surfaced unless
  // the tier is enabled — a partial path would misrepresent the connection.
  if (!isPersonalTierEnabled() && nodes.some((node) => isPersonalNode(node))) return null;

  const rawRels = ((record.get("pathRels") as Neo4jRelationship[]) ?? []).filter(Boolean);
  const edges = rawRels.map((rel) => projectEdge(rel, csidByElementId));

  return {
    from: nodes[0],
    to: nodes[nodes.length - 1],
    nodes,
    edges,
    length: edges.length,
  };
}
