/**
 * AI "explain the connection" narrative route (US-005).
 *
 * `POST /api/graph/explain` — given two entities (each a shared-graph `csid`, or a
 * pinakes entity ref `{ type, id, name, region }` resolved to a csid), find
 * the connecting path in the shared graph, augment it with Datalog inference, and
 * return a Gemini-generated, **sourced** narrative explaining the link (see
 * server/services/connection-narrative.ts). The explanation cites the underlying
 * edges/facts + their provenance and is clearly labelled AI-generated.
 *
 * Graceful degradation (mirrors /api/graph/*): 503 `{ available:false }` when
 * Neo4j is unreachable; 502 when the model returns nothing usable; 400 on a bad
 * request / unresolvable entity ref. No-path and low-confidence are 200 answers
 * with an honest body (never a fabricated link).
 *
 * The resolver, graph traversal, LLM, and Datalog inference are all injectable so
 * the route is exercised with no live Neo4j / model / sidecar.
 */

import express, { type Express, type Request, type Response } from "express";
import * as graphStore from "../services/graph-store";
import { GraphUnavailableError } from "../services/graph-store";
import * as pinakes_engine from "../services/engine-client";
import { getGraphResolver, type GraphResolver } from "../services/graph-resolver";
import {
  explainConnection,
  liveNarrativeLlm,
  type ConnectionEndpoint,
  type ConnectionNarrativeDeps,
  type DatalogFact,
  type NarrativeLlm,
} from "../services/connection-narrative";

/** One endpoint as sent by the client: a csid, or an entity ref to resolve. */
interface EndpointInput {
  csid?: string;
  type?: string;
  id?: string;
  name?: string;
  region?: string;
}

export interface ConnectionNarrativeRouteOptions {
  /** entity-ref → csid resolver (default: the lexicon-backed singleton). */
  resolver?: GraphResolver;
  /** shortest-path traversal (default: graph-store.findPath). */
  findPath?: (fromCsid: string, toCsid: string) => Promise<graphStore.GraphPath | null>;
  /** narrative LLM (default: live Gemini). */
  llm?: NarrativeLlm;
  /** Datalog inference over the endpoints (default: sidecar-backed, graceful). */
  inferFacts?: (fromCsid: string, toCsid: string) => Promise<DatalogFact[]>;
}

const jsonBody = express.json();

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * Resolve one endpoint input to a {@link ConnectionEndpoint}. A `csid` is used
 * directly; otherwise the entity ref is resolved via the graph resolver. Returns
 * `null` (with a reason) when it cannot be resolved.
 */
function resolveEndpoint(
  input: EndpointInput | undefined,
  resolver: GraphResolver,
): { endpoint: ConnectionEndpoint } | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "each of `from` and `to` must be an object" };
  }
  const csid = str(input.csid);
  if (csid) {
    return { endpoint: { csid, name: str(input.name) } };
  }
  const type = str(input.type);
  if (!type) {
    return { error: "an endpoint needs either a `csid` or a `type` + `id`/`name`" };
  }
  const resolved = resolver.resolve({
    type,
    id: str(input.id),
    name: str(input.name),
    region: str(input.region),
  });
  if (!resolved) {
    return {
      error: `could not resolve ${type}:${str(input.id) ?? str(input.name) ?? "?"} to a graph node`,
    };
  }
  return { endpoint: { csid: resolved.csid, name: str(input.name) } };
}

/**
 * Default Datalog inference: ask the sidecar whether the two csids are related by
 * ancestry (both directions). Fragile-by-nature (depends on the sidecar + its
 * ruleset), so any failure — unavailable sidecar, missing SWI-Prolog, lint error —
 * degrades to `[]`. Never throws (the service also guards it).
 */
async function liveInferFacts(fromCsid: string, toCsid: string): Promise<DatalogFact[]> {
  const escape = (s: string) => s.replace(/['\\]/g, "\\$&");
  const check = async (a: string, b: string): Promise<boolean> => {
    try {
      const goal = `main :- ancestor('${escape(a)}', '${escape(b)}'), format("~w~n", ['yes']).`;
      const out = await pinakes_engine.datalog({ goal });
      return out.ran && Array.isArray(out.rows) && out.rows.length > 0;
    } catch {
      return false;
    }
  };
  const facts: DatalogFact[] = [];
  if (await check(fromCsid, toCsid)) {
    facts.push({
      relation: "ancestor",
      statement: `${toCsid} is an ancestor of ${fromCsid} (inferred via descent closure).`,
      csids: [fromCsid, toCsid],
    });
  } else if (await check(toCsid, fromCsid)) {
    facts.push({
      relation: "ancestor",
      statement: `${fromCsid} is an ancestor of ${toCsid} (inferred via descent closure).`,
      csids: [toCsid, fromCsid],
    });
  }
  return facts;
}

export function registerConnectionNarrativeRoutes(
  app: Express,
  options: ConnectionNarrativeRouteOptions = {},
): void {
  const resolver = options.resolver ?? getGraphResolver();
  const maxLength = 4;
  const deps: ConnectionNarrativeDeps = {
    findPath:
      options.findPath ?? ((from, to) => graphStore.findPath(from, to, maxLength)),
    llm: options.llm ?? liveNarrativeLlm,
    inferFacts: options.inferFacts ?? liveInferFacts,
  };

  /**
   * POST /api/graph/explain
   * Body: `{ from: Endpoint, to: Endpoint }` where an Endpoint is `{ csid }` or
   * `{ type, id?, name?, region? }`.
   */
  app.post("/api/graph/explain", jsonBody, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { from?: EndpointInput; to?: EndpointInput };

    const fromResult = resolveEndpoint(body.from, resolver);
    if ("error" in fromResult) {
      return res.status(400).json({ error: `from: ${fromResult.error}` });
    }
    const toResult = resolveEndpoint(body.to, resolver);
    if ("error" in toResult) {
      return res.status(400).json({ error: `to: ${toResult.error}` });
    }

    const from = fromResult.endpoint;
    const to = toResult.endpoint;
    if (from.csid === to.csid) {
      return res.status(400).json({ error: "from and to resolve to the same entity" });
    }

    try {
      const narrative = await explainConnection(from, to, deps);
      res.json(narrative);
    } catch (error) {
      if (error instanceof GraphUnavailableError) {
        return res.status(503).json({
          available: false,
          error: "the shared graph is unavailable",
          detail: error.message,
        });
      }
      // A model/inference failure (after a path was found) → the narrative could
      // not be generated; surface it as a bad upstream response, not swallowed.
      console.error("connection narrative generation failed:", error);
      res.status(502).json({
        error: "narrative generation failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}
