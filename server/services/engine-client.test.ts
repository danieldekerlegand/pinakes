import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the pinakes-engine FastAPI client. The global `fetch` is stubbed
 * — no live network — so we can drive the success, timeout, non-200 and
 * malformed-response paths deterministically against fixtures.
 */
import * as client from "./engine-client";

// ── fetch stubbing ────────────────────────────────────────────────────────────

/** Build a minimal fetch Response stand-in. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A Response whose body is not valid JSON. */
function nonJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
}

/** An error mimicking AbortController's abort (fetch timeout). */
function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), {
    name: "AbortError",
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  client.resetAvailabilityCache();
  delete process.env.PINAKES_ENGINE_ENABLED;
  delete process.env.PINAKES_ENGINE_API_URL;
  delete process.env.PINAKES_ENGINE_TIMEOUT_MS;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── search ────────────────────────────────────────────────────────────────────

describe("search", () => {
  it("returns validated hits and sends q/limit params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: "old",
        results: [
          {
            csid: "cs:language:old-english",
            name: "Old English",
            label: "Language",
            qid: "Q42365",
            field: "name",
            tsv: "/nodes/cs:language:old-english",
            graph: "/graph?csid=cs:language:old-english",
          },
        ],
      }),
    );

    const res = await client.search("old", 10);

    expect(res.results).toHaveLength(1);
    expect(res.results[0].csid).toBe("cs:language:old-english");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("old");
    expect(url.searchParams.get("limit")).toBe("10");
    // Requests JSON explicitly.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Accept).toBe(
      "application/json",
    );
  });

  it("fills optional fields with defaults when omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [{ csid: "cs:x:1", name: "X", label: "Thing" }],
      }),
    );

    const res = await client.search("x");

    expect(res.query).toBe("");
    expect(res.results[0].qid).toBe("");
    expect(res.results[0].graph).toBeNull();
  });

  it("rejects a malformed response with EngineError", async () => {
    // `results` must be an array of objects; a string is malformed.
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: "nope" }));

    await expect(client.search("x")).rejects.toBeInstanceOf(
      client.EngineError,
    );
  });

  it("rejects a non-JSON body with EngineError", async () => {
    fetchMock.mockResolvedValueOnce(nonJsonResponse(200));

    await expect(client.search("x")).rejects.toBeInstanceOf(
      client.EngineError,
    );
  });

  it("maps a 4xx to EngineError carrying the status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "bad" }, 400));

    await expect(client.search("x")).rejects.toMatchObject({
      name: "EngineError",
      status: 400,
    });
  });

  it("maps a 5xx to EngineUnavailableError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));

    await expect(client.search("x")).rejects.toBeInstanceOf(
      client.EngineUnavailableError,
    );
  });

  it("maps a timeout (AbortError) to EngineUnavailableError", async () => {
    fetchMock.mockRejectedValueOnce(abortError());

    await expect(client.search("x")).rejects.toBeInstanceOf(
      client.EngineUnavailableError,
    );
  });

  it("maps a transport failure to EngineUnavailableError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(client.search("x")).rejects.toBeInstanceOf(
      client.EngineUnavailableError,
    );
  });
});

// ── metrics / completeness / datalog / cypher ────────────────────────────────

describe("metrics", () => {
  it("validates the graph-metrics payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        node_count: 100,
        edge_count: 250,
        edges_per_node: 2.5,
        component_count: 3,
        largest_component_size: 90,
        largest_component_fraction: 0.9,
        edges_by_dimension: { temporal: 100, spatial: 150 },
        edges_by_type: { CONTEMPORARY_WITH: 100, SAME_REGION: 150 },
      }),
    );

    const res = await client.metrics(0.8);

    expect(res.node_count).toBe(100);
    expect(res.edges_by_type.CONTEMPORARY_WITH).toBe(100);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("threshold")).toBe("0.8");
  });
});

describe("completeness", () => {
  it("validates rows and a nullable qa digest", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        qa: {
          ok: true,
          node_count: 100,
          edge_count: 250,
          violations: [],
        },
        rows: [
          {
            category_id: "languages",
            label: "Languages",
            status: "complete",
            node_count: 40,
            edge_count: 10,
            violations: [],
          },
        ],
      }),
    );

    const res = await client.completeness({ status: "complete" });

    expect(res.qa?.ok).toBe(true);
    expect(res.rows[0].category_id).toBe("languages");
    // Defaulted optional fields present.
    expect(res.rows[0].last_run).toBe("");
    expect(res.rows[0].provenance_complete).toBe(false);
  });
});

describe("datalog", () => {
  it("validates a query outcome and marks the run flag", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ran: true,
        rows: [["cs:culture:a", "cs:culture:b"]],
        problems: [],
        error: null,
        reason: null,
      }),
    );

    const res = await client.datalog({ goal: "contemporary_with(X, Y)" });

    expect(res.ran).toBe(true);
    expect(res.rows[0]).toEqual(["cs:culture:a", "cs:culture:b"]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("goal")).toBe("contemporary_with(X, Y)");
    expect(url.searchParams.get("run")).toBe("1");
  });
});

describe("cypher", () => {
  it("validates a columns/rows result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        columns: ["name", "csid"],
        rows: [["Old English", "cs:language:old-english"]],
      }),
    );

    const res = await client.cypher("MATCH (n) RETURN n.name, n.csid LIMIT 1");

    expect(res.columns).toEqual(["name", "csid"]);
    expect(res.rows).toHaveLength(1);
  });
});

describe("retrieve", () => {
  it("validates a hybrid-retrieval payload and sends q/k/depth params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: "bread of the mediterranean",
        available: true,
        backend: "neo4j",
        index: "entity_embedding",
        k: 3,
        depth: 1,
        seeds: [
          {
            csid: "cs:dish:paella",
            name: "Paella",
            label: "Dish",
            labels: ["Dish"],
            score: 0.91,
          },
        ],
        nodes: [
          { csid: "cs:dish:paella", name: "Paella", label: "Dish", labels: ["Dish"] },
        ],
        edges: [
          {
            source: "cs:dish:paella",
            target: "cs:place:valencia",
            type: "ORIGINATES_IN",
            dimension: "geographic",
          },
        ],
      }),
    );

    const res = await client.retrieve("bread of the mediterranean", {
      k: 3,
      depth: 1,
    });

    expect(res.available).toBe(true);
    expect(res.seeds[0].score).toBeCloseTo(0.91);
    expect(res.edges[0].type).toBe("ORIGINATES_IN");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/retrieve");
    expect(url.searchParams.get("q")).toBe("bread of the mediterranean");
    expect(url.searchParams.get("k")).toBe("3");
    expect(url.searchParams.get("depth")).toBe("1");
  });

  it("maps a 503 (embedder/Neo4j absent) to an unavailable error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ available: false }, 503));

    await expect(client.retrieve("anything")).rejects.toBeInstanceOf(
      client.EngineUnavailableError,
    );
  });
});

// ── isAvailable ───────────────────────────────────────────────────────────────

describe("isAvailable", () => {
  it("returns true and caches when the sidecar answers ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 200));

    expect(await client.isAvailable()).toBe(true);
    // Second call within the TTL is served from cache — no extra fetch.
    expect(await client.isAvailable()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when the sidecar is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(await client.isAvailable()).toBe(false);
  });

  it("returns false without probing when disabled via env", async () => {
    process.env.PINAKES_ENGINE_ENABLED = "false";

    expect(await client.isAvailable()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws EngineUnavailableError from wrappers when disabled", async () => {
    process.env.PINAKES_ENGINE_ENABLED = "0";

    await expect(client.search("x")).rejects.toBeInstanceOf(
      client.EngineUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── config ────────────────────────────────────────────────────────────────────

describe("configuration", () => {
  it("targets PINAKES_ENGINE_API_URL and trims a trailing slash", async () => {
    process.env.PINAKES_ENGINE_API_URL = "http://sidecar:8800/";
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));

    await client.search("x");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin).toBe("http://sidecar:8800");
    expect(url.pathname).toBe("/search");
  });
});
