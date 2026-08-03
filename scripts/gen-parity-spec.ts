/**
 * Generate the Express → FastAPI **parity baseline spec**
 * (`contracts/parity/openapi.json`) — tasks/chief/30-api-shell-parity.json US-1.
 *
 * The spec is HARVESTED, never hand-written: it boots the real Express app,
 * registers the real routes, and walks the router stack, so it cannot drift from
 * what the server actually serves. Two static passes enrich it:
 *
 *  - **source attribution** — which `server/` file registers each operation, so a
 *    port tasklist can pick up "everything in routes/collections.ts" as one unit;
 *  - **client usage** — which `/api/...` templates `web/src` actually references,
 *    so the port order can follow what the React client depends on.
 *
 * Recorded response shapes (`contracts/parity/fixtures/`, written by
 * `scripts/record-parity-fixtures.ts`) are folded in as each operation's 2xx
 * response schema when one exists.
 *
 * Usage:
 *   npx tsx scripts/gen-parity-spec.ts            # write contracts/parity/openapi.json
 *   npx tsx scripts/gen-parity-spec.ts --check    # exit 1 if the committed spec is stale
 */
import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";

import { loadParityFixtures, type ParityFixture } from "@contracts/parity/harness";
import type { TypeShape } from "@contracts/parity/shape";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const WEB_SRC_DIR = path.join(REPO_ROOT, "web", "src");
const PARITY_DIR = path.join(REPO_ROOT, "contracts", "parity");
const SPEC_PATH = path.join(PARITY_DIR, "openapi.json");

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface HarvestedRoute {
  method: HttpMethod;
  /** The Express path as registered, e.g. `/api/collections/:id/items`. */
  expressPath: string;
}

/** `"<method> <expressPath>"` → repo-relative file that registers it. */
export type RouteSourceMap = Map<string, string>;

export interface ParitySpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  "x-pinakes-parity": {
    generatedBy: string;
    baseline: string;
    routeCount: number;
    fixtureCount: number;
    clientReferencedCount: number;
    /**
     * `/api/...` literals in `web/src` that NO harvested route serves — dead
     * client calls. Recorded rather than hidden: the port must not reproduce them,
     * and the list going up means someone added a call to a route that isn't there.
     */
    unservedClientReferences: string[];
  };
  paths: Record<string, Record<string, ParityOperation>>;
}

export interface ParityOperation {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: { name: string; in: "path"; required: true; schema: { type: "string" } }[];
  responses: Record<string, { description: string; content?: Record<string, { schema: unknown }> }>;
  "x-pinakes-parity": {
    /** Repo-relative file registering the Express handler (the thing to port). */
    source: string | null;
    /** `web/src` references this route template. */
    clientUsed: boolean;
    /** Fixture ids that pin this operation's response shape. */
    fixtures: string[];
  };
}

// ── harvest ────────────────────────────────────────────────────────────────────

interface ExpressLayer {
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: unknown[] };
  handle?: { stack?: ExpressLayer[] };
  name?: string;
}

/**
 * Walk an Express 4 app's router stack. `registerRoutes` mounts every handler
 * directly on the app (no sub-routers today), but nested stacks are followed
 * anyway so a future `express.Router()` doesn't silently vanish from the baseline.
 */
export function collectExpressRoutes(app: Express): HarvestedRoute[] {
  const stack: ExpressLayer[] = ((app as unknown as { _router?: { stack: ExpressLayer[] } })._router?.stack) ?? [];
  const routes: HarvestedRoute[] = [];
  const visit = (layers: ExpressLayer[]): void => {
    for (const layer of layers) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const expressPath of paths) {
          for (const method of HTTP_METHODS) {
            if (layer.route.methods[method]) routes.push({ method, expressPath });
          }
        }
      } else if (layer.handle?.stack) {
        visit(layer.handle.stack);
      }
    }
  };
  visit(stack);
  return dedupeRoutes(routes);
}

function dedupeRoutes(routes: HarvestedRoute[]): HarvestedRoute[] {
  const seen = new Map<string, HarvestedRoute>();
  for (const route of routes) seen.set(`${route.method} ${route.expressPath}`, route);
  return [...seen.values()].sort(
    (a, b) => a.expressPath.localeCompare(b.expressPath) || a.method.localeCompare(b.method),
  );
}

/**
 * Attribute each registration to the file it lives in by instrumenting the app's
 * verb methods and reading the *call site* off a stack trace.
 *
 * Static regex was the obvious alternative and it misses the registrations whose
 * path is a constant (`app.get(MCP_ROUTE_PATH, …)`, the `.well-known` documents);
 * the stack is exact for those too. `tsx` emits source maps, so frames name the
 * original `.ts` file.
 *
 * Gotcha: `app.get(name)` with no handler is Express's *settings getter*
 * (`app.get("env")`), not a route — hence the `handlers.length > 0` guard.
 */
export function instrumentRouteSources(app: Express): Map<string, string> {
  const sources = new Map<string, string>();
  const target = app as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of HTTP_METHODS) {
    const original = target[method].bind(app);
    target[method] = (routePath: unknown, ...handlers: unknown[]) => {
      if (typeof routePath === "string" && handlers.length > 0) {
        const file = callerFile(new Error().stack ?? "");
        if (file) sources.set(`${method} ${routePath}`, file);
      }
      return original(routePath, ...handlers);
    };
  }
  return sources;
}

/** First stack frame belonging to repo source other than this generator. */
export function callerFile(stack: string, repoRoot = REPO_ROOT, self = "scripts/gen-parity-spec.ts"): string | null {
  for (const line of stack.split("\n").slice(1)) {
    const match = line.match(/\(?((?:\/|file:\/\/\/)[^):]+\.[cm]?tsx?)(?::\d+:\d+)?\)?\s*$/);
    if (!match) continue;
    const absolute = match[1].replace(/^file:\/\//, "");
    if (!absolute.startsWith(repoRoot) || absolute.includes("node_modules")) continue;
    const relative = path.relative(repoRoot, absolute);
    if (relative === self) continue;
    return relative;
  }
  return null;
}

// ── client usage ───────────────────────────────────────────────────────────────

const CLIENT_API_REFERENCE = /["'`](\/api\/[^"'`\s]*)["'`]|["'`](\/api\/[^"'`\s]*)/g;

/**
 * Normalize a path (Express `:id`, a client template `${id}`, an OpenAPI `{id}`)
 * to a comparable key with every dynamic segment collapsed to `{}`. Query strings
 * and trailing slashes are dropped.
 */
export function normalizePathTemplate(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0].replace(/\/+$/, "") || "/";
  return withoutQuery
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "{}";
      if (segment.startsWith("{") && segment.endsWith("}")) return "{}";
      if (segment.includes("${")) return "{}";
      if (segment === "*") return "{}";
      return segment;
    })
    .join("/");
}

/**
 * Does a route template serve this client reference? Compared segment-wise, with
 * a route's `{}` (a path param) matching any single client segment — so the
 * concrete `/api/summaries/religions` matches `/api/summaries/:domain`.
 */
export function routeMatchesReference(routeKey: string, referenceKey: string): boolean {
  const routeSegments = routeKey.split("/");
  const refSegments = referenceKey.split("/");
  if (routeSegments.length !== refSegments.length) return false;
  return routeSegments.every(
    (segment, index) => segment === "{}" || refSegments[index] === "{}" || segment === refSegments[index],
  );
}

/** A client reference that is a strict leading prefix of a route (a query-key stem). */
function isRoutePrefix(routeKey: string, referenceKey: string): boolean {
  const routeSegments = routeKey.split("/");
  const refSegments = referenceKey.split("/");
  if (refSegments.length >= routeSegments.length) return false;
  return refSegments.every(
    (segment, index) => segment === routeSegments[index] || routeSegments[index] === "{}" || segment === "{}",
  );
}

/**
 * References that are documentation rather than a call: an OpenAPI-style
 * placeholder (`/api/<domain>/:id`), a wildcard mount (`/api/map/*`), or a test
 * sentinel. Filtered so the "client calls a route we do not serve" signal stays
 * meaningful.
 */
export function isIllustrativeReference(reference: string): boolean {
  return /[<>*]/.test(reference) || reference.includes("__none__");
}

export interface ClientReferenceReport {
  /** Normalized keys that a harvested route serves. */
  served: Set<string>;
  /** Query-key stems — a prefix of a real route, never fetched as-is. */
  prefixOnly: string[];
  /** Referenced by the client with no route to serve it (dead client code). */
  unserved: string[];
}

export function classifyClientReferences(
  routeKeys: string[],
  references: string[],
): ClientReferenceReport {
  const served = new Set<string>();
  const prefixOnly: string[] = [];
  const unserved: string[] = [];
  for (const reference of references) {
    if (isIllustrativeReference(reference)) continue;
    const key = normalizePathTemplate(reference);
    if (key === "/api") continue;
    if (routeKeys.some((routeKey) => routeMatchesReference(routeKey, key))) {
      served.add(key);
    } else if (routeKeys.some((routeKey) => isRoutePrefix(routeKey, key))) {
      prefixOnly.push(reference);
    } else {
      unserved.push(reference);
    }
  }
  return { served, prefixOnly: prefixOnly.sort(), unserved: unserved.sort() };
}

/** Every distinct `/api/...` literal referenced under `web/src`. */
export function collectClientApiReferences(files: { content: string }[]): string[] {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(CLIENT_API_REFERENCE)) {
      const raw = match[1] ?? match[2];
      if (!raw) continue;
      // A template literal's `${…}` may itself contain quotes/backticks; keep the
      // segment shape and let normalization collapse it.
      found.add(raw);
    }
  }
  return [...found].sort();
}

function readSourceFiles(dir: string): { path: string; content: string }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { path: string; content: string }[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        // Test files reference deliberately-nonexistent paths (`/api/collections/__none__`);
        // counting those as client usage would inflate the baseline.
        out.push({ path: path.relative(REPO_ROOT, full), content: fs.readFileSync(full, "utf-8") });
      }
    }
  };
  walk(dir);
  return out;
}

// ── spec assembly ──────────────────────────────────────────────────────────────

export function expressPathToOpenApi(expressPath: string): string {
  return expressPath
    .split("/")
    .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
    .join("/");
}

export function pathParameters(expressPath: string): string[] {
  return expressPath
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1).replace(/[^A-Za-z0-9_]/g, ""));
}

export function operationIdFor(method: HttpMethod, expressPath: string): string {
  const slug = expressPath
    .replace(/^\//, "")
    .replace(/:/g, "by-")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${method}-${slug}` || method;
}

/** First path segment after `/api` — the natural port unit / router filename. */
export function tagFor(expressPath: string): string {
  const segments = expressPath.split("/").filter(Boolean);
  if (segments[0] === "api") return segments[1] ?? "root";
  if (segments[0] === ".well-known") return "well-known";
  return segments[0] ?? "root";
}

/** Translate a recorded `TypeShape` into a JSON-Schema-ish node for the spec. */
export function shapeToSchema(shape: TypeShape): Record<string, unknown> {
  switch (shape.kind) {
    case "array":
      return { type: "array", items: shape.items ? shapeToSchema(shape.items) : {} };
    case "object": {
      const optional = new Set(shape.optional ?? []);
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(shape.properties)) {
        properties[key] = shapeToSchema(value);
      }
      const required = Object.keys(shape.properties)
        .filter((key) => !optional.has(key))
        .sort();
      const schema: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) schema.required = required;
      return schema;
    }
    case "union":
      return { oneOf: shape.of.map(shapeToSchema) };
    case "null":
      return { nullable: true };
    case "unknown":
      return {};
    default:
      return { type: shape.kind };
  }
}

export interface BuildSpecInput {
  routes: HarvestedRoute[];
  sources: RouteSourceMap;
  clientReferences: string[];
  fixtures: ParityFixture[];
  version: string;
}

export function buildParitySpec(input: BuildSpecInput): ParitySpec {
  const sourceByKey = input.sources;
  const routeKeys = [...new Set(input.routes.map((route) => normalizePathTemplate(route.expressPath)))];
  const clientReport = classifyClientReferences(routeKeys, input.clientReferences);
  const fixturesByKey = new Map<string, ParityFixture[]>();
  for (const fixture of input.fixtures) {
    const key = `${fixture.request.method.toLowerCase()} ${normalizePathTemplate(fixture.request.route)}`;
    const list = fixturesByKey.get(key) ?? [];
    list.push(fixture);
    fixturesByKey.set(key, list);
  }

  const paths: Record<string, Record<string, ParityOperation>> = {};
  let clientReferencedCount = 0;
  let fixtureCount = 0;

  for (const route of input.routes) {
    const specPath = expressPathToOpenApi(route.expressPath);
    const normalized = normalizePathTemplate(route.expressPath);
    const clientUsed = [...clientReport.served].some((key) => routeMatchesReference(normalized, key));
    if (clientUsed) clientReferencedCount += 1;

    const routeFixtures = (fixturesByKey.get(`${route.method} ${normalized}`) ?? []).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    fixtureCount += routeFixtures.length;

    const responses: ParityOperation["responses"] = {};
    for (const fixture of routeFixtures) {
      responses[String(fixture.response.status)] = {
        description: fixture.description,
        content: {
          [fixture.response.contentType?.split(";")[0] ?? "application/json"]: {
            schema: shapeToSchema(fixture.response.shape),
          },
        },
      };
    }
    if (Object.keys(responses).length === 0) {
      responses.default = { description: "Not yet recorded — shape unpinned." };
    }

    const parameters = pathParameters(route.expressPath).map((name) => ({
      name,
      in: "path" as const,
      required: true as const,
      schema: { type: "string" as const },
    }));

    const operation: ParityOperation = {
      operationId: operationIdFor(route.method, route.expressPath),
      summary: `${route.method.toUpperCase()} ${specPath}`,
      tags: [tagFor(route.expressPath)],
      ...(parameters.length > 0 ? { parameters } : {}),
      responses,
      "x-pinakes-parity": {
        source: sourceByKey.get(`${route.method} ${route.expressPath}`) ?? null,
        clientUsed,
        fixtures: routeFixtures.map((fixture) => fixture.id),
      },
    };

    paths[specPath] = paths[specPath] ?? {};
    paths[specPath][route.method] = operation;
  }

  const orderedPaths: Record<string, Record<string, ParityOperation>> = {};
  for (const specPath of Object.keys(paths).sort()) orderedPaths[specPath] = paths[specPath];

  return {
    openapi: "3.0.3",
    info: {
      title: "pinakes API parity baseline",
      version: input.version,
      description:
        "Machine-generated inventory of every route the TypeScript Express server serves, " +
        "captured as the contract the Python (FastAPI) service must satisfy as route groups " +
        "are ported. Generated by scripts/gen-parity-spec.ts — do not hand-edit. Response " +
        "schemas come from recorded fixtures in contracts/parity/fixtures/.",
    },
    servers: [{ url: "/", description: "This pinakes instance" }],
    "x-pinakes-parity": {
      generatedBy: "scripts/gen-parity-spec.ts",
      baseline: "server/ (Express)",
      routeCount: input.routes.length,
      fixtureCount,
      clientReferencedCount,
      unservedClientReferences: clientReport.unserved,
    },
    paths: orderedPaths,
  };
}

// ── orchestration ──────────────────────────────────────────────────────────────

/**
 * Boot the real Express app purely to read its routing table back out. The HTTP
 * server `registerRoutes` creates is never listened on; it is closed immediately.
 */
export async function harvestRoutesFromApp(): Promise<{
  routes: HarvestedRoute[];
  sources: RouteSourceMap;
}> {
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json());
  const sources = instrumentRouteSources(app);
  const server = await registerRoutes(app);
  const routes = collectExpressRoutes(app);
  server.close();
  return { routes, sources };
}

export async function generateParitySpec(): Promise<ParitySpec> {
  const { routes, sources } = await harvestRoutesFromApp();
  const clientReferences = collectClientApiReferences(readSourceFiles(WEB_SRC_DIR));
  const fixtures = loadParityFixtures(path.join(PARITY_DIR, "fixtures"));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
    version?: string;
  };
  return buildParitySpec({
    routes,
    sources,
    clientReferences,
    fixtures,
    version: pkg.version ?? "0.0.0",
  });
}

export function serializeSpec(spec: ParitySpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const spec = await generateParitySpec();
  const serialized = serializeSpec(spec);

  if (check) {
    const committed = fs.existsSync(SPEC_PATH) ? fs.readFileSync(SPEC_PATH, "utf-8") : "";
    if (committed !== serialized) {
      console.error(
        `parity spec is stale: ${path.relative(REPO_ROOT, SPEC_PATH)} differs from the live routing table.\n` +
          "Run: npx tsx scripts/gen-parity-spec.ts",
      );
      process.exit(1);
    }
    console.log(`parity spec up to date (${spec["x-pinakes-parity"].routeCount} routes)`);
    return;
  }

  fs.mkdirSync(path.dirname(SPEC_PATH), { recursive: true });
  fs.writeFileSync(SPEC_PATH, serialized);
  const { routeCount, clientReferencedCount, fixtureCount } = spec["x-pinakes-parity"];
  console.log(
    `wrote ${path.relative(REPO_ROOT, SPEC_PATH)} — ${routeCount} routes ` +
      `(${clientReferencedCount} referenced by web/src, ${fixtureCount} fixture-pinned)`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  void main().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
