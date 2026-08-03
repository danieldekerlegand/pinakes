import express from "express";
import { describe, expect, it } from "vitest";

import { describeShape } from "@contracts/parity/shape";
import type { ParityFixture } from "@contracts/parity/harness";

import {
  buildParitySpec,
  callerFile,
  classifyClientReferences,
  collectClientApiReferences,
  collectExpressRoutes,
  expressPathToOpenApi,
  instrumentRouteSources,
  isIllustrativeReference,
  normalizePathTemplate,
  operationIdFor,
  pathParameters,
  routeMatchesReference,
  shapeToSchema,
  tagFor,
  type HarvestedRoute,
} from "./gen-parity-spec";

describe("collectExpressRoutes", () => {
  it("harvests every verb registered on the app, deduped and sorted", () => {
    const app = express();
    app.get("/api/things", (_req, res) => res.json([]));
    app.post("/api/things", (_req, res) => res.json({}));
    app.get("/api/things/:id", (_req, res) => res.json({}));
    // A settings read, not a route — must not appear.
    app.get("env");

    expect(collectExpressRoutes(app)).toEqual([
      { method: "get", expressPath: "/api/things" },
      { method: "post", expressPath: "/api/things" },
      { method: "get", expressPath: "/api/things/:id" },
    ]);
  });

  it("follows a nested router", () => {
    const app = express();
    const router = express.Router();
    router.get("/nested", (_req, res) => res.json({}));
    app.use(router);
    expect(collectExpressRoutes(app)).toEqual([{ method: "get", expressPath: "/nested" }]);
  });
});

describe("instrumentRouteSources", () => {
  it("attributes a registration to its call site, including a constant path", () => {
    const app = express();
    const sources = instrumentRouteSources(app);
    const ROUTE = "/mcp";
    app.get("/api/things", (_req, res) => res.json([]));
    app.post(ROUTE, (_req, res) => res.json({}));
    app.get("env");

    expect(sources.get("get /api/things")).toBe("scripts/gen-parity-spec.test.ts");
    expect(sources.get("post /mcp")).toBe("scripts/gen-parity-spec.test.ts");
    expect(sources.has("get env")).toBe(false);
  });

  it("still registers the routes it instruments", async () => {
    const app = express();
    instrumentRouteSources(app);
    app.get("/api/things", (_req, res) => res.json([]));
    expect(collectExpressRoutes(app)).toEqual([{ method: "get", expressPath: "/api/things" }]);
  });
});

describe("callerFile", () => {
  const root = "/repo";

  it("skips node_modules and the generator itself", () => {
    const stack = [
      "Error",
      "    at instrumentRouteSources (/repo/scripts/gen-parity-spec.ts:130:20)",
      "    at Function.get (/repo/node_modules/express/lib/application.js:481:22)",
      "    at registerMcpRoutes (/repo/server/routes/mcp.ts:431:7)",
    ].join("\n");
    expect(callerFile(stack, root)).toBe("server/routes/mcp.ts");
  });

  it("returns null when no repo frame is present", () => {
    expect(callerFile("Error\n    at /elsewhere/lib.js:1:1", root)).toBeNull();
  });
});

describe("normalizePathTemplate", () => {
  it("collapses every dynamic segment shape to the same key", () => {
    expect(normalizePathTemplate("/api/collections/:id/items")).toBe("/api/collections/{}/items");
    expect(normalizePathTemplate("/api/collections/${id}/items")).toBe("/api/collections/{}/items");
    expect(normalizePathTemplate("/api/collections/{id}/items")).toBe("/api/collections/{}/items");
  });

  it("drops the query string and a trailing slash", () => {
    expect(normalizePathTemplate("/api/search?q=x&limit=5")).toBe("/api/search");
    expect(normalizePathTemplate("/api/search/")).toBe("/api/search");
  });
});

describe("routeMatchesReference", () => {
  it("lets a route parameter absorb a concrete client segment", () => {
    expect(routeMatchesReference("/api/summaries/{}", "/api/summaries/religions")).toBe(true);
    expect(routeMatchesReference("/api/summaries/{}", "/api/summaries")).toBe(false);
    expect(routeMatchesReference("/api/summaries/{}", "/api/citations/religions")).toBe(false);
  });
});

describe("classifyClientReferences", () => {
  const routeKeys = ["/api/languages", "/api/languages/{}", "/api/summaries/{}"];

  it("separates served calls, query-key stems and dead calls", () => {
    const report = classifyClientReferences(routeKeys, [
      "/api/languages",
      "/api/languages/${id}",
      "/api/summaries/religions",
      "/api/summaries",
      "/api/linguistic-services/status",
    ]);
    expect([...report.served].sort()).toEqual([
      "/api/languages",
      "/api/languages/{}",
      "/api/summaries/religions",
    ]);
    expect(report.prefixOnly).toEqual(["/api/summaries"]);
    expect(report.unserved).toEqual(["/api/linguistic-services/status"]);
  });

  it("ignores illustrative references from docs and tests", () => {
    const report = classifyClientReferences(routeKeys, [
      "/api/<domain>/:id",
      "/api/map/*",
      "/api/collections/__none__",
      "/api/",
    ]);
    expect(report.unserved).toEqual([]);
    expect(isIllustrativeReference("/api/map/*")).toBe(true);
    expect(isIllustrativeReference("/api/languages")).toBe(false);
  });
});

describe("collectClientApiReferences", () => {
  it("finds quoted and templated api paths", () => {
    const refs = collectClientApiReferences([
      { content: 'useQuery({ queryKey: ["/api/languages"] })' },
      { content: "fetch(`/api/languages/${id}`)" },
      { content: "const other = 'not an api path';" },
    ]);
    expect(refs).toEqual(["/api/languages", "/api/languages/${id}"]);
  });
});

describe("path helpers", () => {
  it("converts express params to OpenAPI templates", () => {
    expect(expressPathToOpenApi("/api/entity/:domain/:id")).toBe("/api/entity/{domain}/{id}");
    expect(pathParameters("/api/entity/:domain/:id")).toEqual(["domain", "id"]);
  });

  it("derives a stable operation id and a port-unit tag", () => {
    expect(operationIdFor("get", "/api/entity/:domain/:id")).toBe("get-api-entity-by-domain-by-id");
    expect(tagFor("/api/collections/:id")).toBe("collections");
    expect(tagFor("/.well-known/kcb-manifest.json")).toBe("well-known");
  });
});

describe("shapeToSchema", () => {
  it("marks always-present properties required and optional ones not", () => {
    const shape = describeShape([{ id: "a", note: "x" }, { id: "b" }]);
    expect(shapeToSchema(shape)).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, note: { type: "string" } },
        required: ["id"],
      },
    });
  });
});

describe("buildParitySpec", () => {
  const routes: HarvestedRoute[] = [
    { method: "get", expressPath: "/api/languages" },
    { method: "get", expressPath: "/api/languages/:id" },
    { method: "post", expressPath: "/api/timeline/event" },
  ];
  const fixture: ParityFixture = {
    id: "get-languages",
    description: "The language corpus list.",
    request: { method: "GET", path: "/api/languages", route: "/api/languages" },
    response: {
      status: 200,
      contentType: "application/json",
      shape: describeShape([{ id: "cmn" }]),
      sample: [{ id: "cmn" }],
    },
  };

  const spec = buildParitySpec({
    routes,
    sources: new Map([["get /api/languages", "server/routes.ts"]]),
    clientReferences: ["/api/languages", "/api/languages/${id}", "/api/gone"],
    fixtures: [fixture],
    version: "1.0.0",
  });

  it("emits one operation per harvested route, keyed by OpenAPI path", () => {
    expect(Object.keys(spec.paths)).toEqual([
      "/api/languages",
      "/api/languages/{id}",
      "/api/timeline/event",
    ]);
    expect(spec.paths["/api/languages/{id}"].get.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
  });

  it("carries the porting metadata: source file, client usage, fixtures", () => {
    const parity = spec.paths["/api/languages"].get["x-pinakes-parity"];
    expect(parity).toEqual({ source: "server/routes.ts", clientUsed: true, fixtures: ["get-languages"] });
    expect(spec.paths["/api/timeline/event"].post["x-pinakes-parity"]).toEqual({
      source: null,
      clientUsed: false,
      fixtures: [],
    });
  });

  it("folds a recorded shape into the operation's response schema", () => {
    const responses = spec.paths["/api/languages"].get.responses;
    expect(Object.keys(responses)).toEqual(["200"]);
    expect(responses["200"].content?.["application/json"].schema).toEqual({
      type: "array",
      items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    });
    expect(spec.paths["/api/timeline/event"].post.responses.default.description).toMatch(/unpinned/);
  });

  it("records client calls no route serves", () => {
    expect(spec["x-pinakes-parity"].unservedClientReferences).toEqual(["/api/gone"]);
    expect(spec["x-pinakes-parity"].routeCount).toBe(3);
    expect(spec["x-pinakes-parity"].clientReferencedCount).toBe(2);
  });
});
