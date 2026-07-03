/**
 * Neo4j TypeScript data-access layer for the shared culture-scrape graph.
 *
 * LinguaScrape queries the shared correlation store two ways (see
 * docs/culturescrape-integration.md): the FastAPI proxy for search/Datalog, and
 * this module — the official `neo4j-driver` — for relational/graph queries
 * (node lookup, neighborhood traversal, correlation edges).
 *
 * The canonical graph schema (packages/culture-scrape/docs/data-model.md):
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
 * Look up a single node by its `csid`. Returns `null` when no such node exists.
 * @throws {GraphUnavailableError} when Neo4j cannot be reached.
 */
export async function getNode(csid: string): Promise<GraphNode | null> {
  const result = await runRead(
    "MATCH (n {csid: $csid}) RETURN n LIMIT 1",
    { csid },
  );
  const record = result.records[0];
  if (!record) return null;
  return projectNode(record.get("n") as Neo4jNode);
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

  return {
    root: projectNode(focus),
    nodes,
    edges: Array.from(edgesById.values()),
    depth,
  };
}

/**
 * Return the entities directly correlated with a focus node. When `relationship`
 * is given, only edges of that `:TYPE` are followed (e.g. `CONTEMPORARY_WITH`,
 * `SAME_REGION`); otherwise every direct relationship is returned. Ordered by
 * descending edge weight, then name.
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
  return result.records.map((record) => {
    const node = projectNode(record.get("other") as Neo4jNode);
    const rawWeight = coerceValue(record.get("weight"));
    const weight = typeof rawWeight === "number" ? rawWeight : undefined;
    return {
      node,
      relationship: record.get("relType") as string,
      ...(weight !== undefined ? { weight } : {}),
    };
  });
}
