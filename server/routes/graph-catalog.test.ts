import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { registerGraphRoutes } from "./graph";

/**
 * Drift guard for the `/api/graph/*` route catalog documented in
 * `docs/engine-integration.md` §10b.
 *
 * §10b is the contract the web app codes against: every first-party graph route,
 * its backend, and — crucially — the graceful-degradation promise (503
 * `{ available:false }` when a backend is down, 502 on an unusable upstream
 * response) so graph-dependent UI can switch itself off instead of crashing.
 * A route that is registered but *undocumented* silently escapes that contract,
 * which is exactly what happened to `GET /api/graph/retrieve`.
 *
 * So rather than trusting prose, this compares the catalog against the routes
 * `registerGraphRoutes` actually registers, in both directions. The registration
 * side is captured with a recording stub instead of Express internals: the
 * production code path is unchanged and nothing is mounted or listened on.
 */

/** Repo root — `server/routes/` sits two levels below it. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const INTEGRATION_DOC = path.join(REPO_ROOT, "docs", "engine-integration.md");

/** `"GET /api/graph/search"` — method + path, no query string. */
type RouteKey = string;

/** Record the (method, path) pairs `registerGraphRoutes` registers. */
function registeredRoutes(): Set<RouteKey> {
  const seen = new Set<RouteKey>();
  const record =
    (method: string) =>
    (routePath: string, ...rest: unknown[]) => {
      void rest; // middleware + handler; only the path matters here
      seen.add(`${method} ${routePath}`);
    };
  const stub = { get: record("GET"), post: record("POST") };
  registerGraphRoutes(stub as unknown as Express);
  return seen;
}

/**
 * The §10b table rows, as `{ key, backend, notes }`.
 *
 * Rows look like ``| `GET /api/graph/search?q=&limit=` | sidecar `/search` | … |``.
 * The documented path carries a query string and Express carries `:params`, so the
 * key is normalized to method + path-before-`?`.
 */
function documentedRoutes(): Map<RouteKey, { backend: string; notes: string }> {
  expect(
    existsSync(INTEGRATION_DOC),
    `${INTEGRATION_DOC} is missing — §10b is the /api/graph/* contract; if the doc ` +
      "moved, re-point this guard rather than deleting it",
  ).toBe(true);
  const doc = readFileSync(INTEGRATION_DOC, "utf8");

  const section = doc.split("## 10b.")[1];
  expect(section, "docs/engine-integration.md has no '## 10b.' section").toBeDefined();
  // Stop at the next h2 so a later section's table cannot leak in.
  const body = section.split("\n## ")[0];

  const rows = new Map<RouteKey, { backend: string; notes: string }>();
  for (const line of body.split("\n")) {
    const match = /^\|\s*`(GET|POST)\s+(\/api\/graph\/[^`?]*)[^`]*`\s*\|(.*)\|\s*$/.exec(line);
    if (!match) continue;
    const [, method, routePath, rest] = match;
    const cells = rest.split("|");
    rows.set(`${method} ${routePath}`, {
      backend: (cells[0] ?? "").trim(),
      notes: (cells[2] ?? "").trim(),
    });
  }
  return rows;
}

describe("/api/graph/* route catalog (docs/engine-integration.md §10b)", () => {
  it("documents every registered route", () => {
    const undocumented = [...registeredRoutes()].filter((r) => !documentedRoutes().has(r));
    expect(
      undocumented,
      "these /api/graph/* routes are registered but missing from the §10b catalog, so " +
        "their degradation behaviour is undocumented — add a row (method, backend, " +
        "success shape, degradation) per the §10b checklist",
    ).toEqual([]);
  });

  it("documents no route that is not registered", () => {
    const registered = registeredRoutes();
    const stale = [...documentedRoutes().keys()].filter((r) => !registered.has(r));
    expect(
      stale,
      "these rows are in the §10b catalog but no longer registered by " +
        "registerGraphRoutes — remove the row or restore the route",
    ).toEqual([]);
  });

  it("names a backend for every catalogued route", () => {
    for (const [route, { backend }] of documentedRoutes()) {
      expect(backend, `§10b row for ${route} has an empty Backend cell`).not.toBe("");
    }
  });

  it("still states the degradation contract the catalog degrades under", () => {
    const body = readFileSync(INTEGRATION_DOC, "utf8").split("## 10b.")[1].split("\n## ")[0];
    // The three promises graph-dependent UI is built on (§10b, US-005).
    expect(body).toContain("**503**");
    expect(body).toContain("available: false");
    expect(body).toContain("**502**");
  });

  it("catalogues the routes the guard exists to protect", () => {
    // A regex that matched nothing would make every assertion above vacuously
    // true, so pin a non-trivial floor and the route that was found missing.
    const documented = documentedRoutes();
    expect(documented.size).toBeGreaterThanOrEqual(10);
    expect(documented.has("GET /api/graph/retrieve")).toBe(true);
    expect(registeredRoutes().size).toBe(documented.size);
  });
});
