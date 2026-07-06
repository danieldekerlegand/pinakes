/**
 * AI "explain the connection" narrative generator (US-005).
 *
 * Given two entities in the shared culture-scrape graph, this service traverses
 * the graph for the shortest connecting path (server/services/graph-store
 * {@link ../services/graph-store.findPath}), optionally augments it with Datalog
 * inference (the sidecar's `/datalog` console), and asks the **existing Gemini
 * client** to write a short, sourced narrative explaining how the two are linked.
 *
 * The narrative is grounded in real evidence: every claim is backed by an edge
 * (or an inferred fact) whose provenance — source, source URL, confidence — is
 * extracted from the graph and returned alongside the prose so a reader can
 * verify it. The result is always clearly labelled AI-generated.
 *
 * Honesty is built in (AC3):
 *   - **No path** → a plain, non-AI message ("no connection found"); the LLM is
 *     never asked to invent a link that the graph does not support.
 *   - **Low confidence** → the aggregate path confidence is surfaced and the
 *     result is flagged `lowConfidence` so the UI can hedge accordingly.
 *
 * The LLM, the graph traversal, and the Datalog inference are all injectable
 * (`ConnectionNarrativeDeps`) so tests drive the whole pipeline with recorded
 * fixtures — no live model, no live Neo4j, no live sidecar.
 */

import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import type { GraphNode, GraphPath } from "./graph-store";

// ── Public shapes ─────────────────────────────────────────────────────────────

/** A minimal reference to one endpoint entity being explained. */
export interface ConnectionEndpoint {
  /** shared-graph csid (`cs:<type>:<id>`). */
  csid: string;
  /** display name, when known. */
  name?: string;
}

/** One piece of evidence backing the narrative, with its provenance. */
export interface ConnectionEvidence {
  /** what kind of evidence this is. */
  kind: "edge" | "datalog";
  /** human-readable statement of the link (e.g. "Latin → descends-from → PIE"). */
  statement: string;
  /** csid of the "from" endpoint of this edge/fact, when applicable. */
  fromCsid?: string;
  /** csid of the "to" endpoint of this edge/fact, when applicable. */
  toCsid?: string;
  /** the relationship / predicate type. */
  relationship?: string;
  /** citation source string, when the edge/node carries one. */
  source?: string;
  /** source URL, when present. */
  sourceUrl?: string;
  /** 0..1 confidence/weight of this specific link, when present. */
  confidence?: number;
}

/** A Datalog-inferred fact linking the two endpoints. */
export interface DatalogFact {
  /** short predicate/relation name, e.g. `ancestor`. */
  relation: string;
  /** human-readable statement of the inference. */
  statement: string;
  /** csids the fact relates, in order. */
  csids?: string[];
}

/** The full "explain the connection" result. */
export interface ConnectionNarrative {
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  /** true when a connecting path (or inferred fact) was found. */
  connected: boolean;
  /** the generated (or honest fallback) prose explanation. */
  explanation: string;
  /** every edge/fact the explanation is grounded in, with provenance. */
  evidence: ConnectionEvidence[];
  /** aggregate 0..1 confidence across the path evidence (0 when no path). */
  confidence: number;
  /** true when `confidence` is below {@link LOW_CONFIDENCE_THRESHOLD}. */
  lowConfidence: boolean;
  /** number of hops on the connecting path (0 when none). */
  pathLength: number;
  /**
   * true when the prose came from the LLM; false for the honest no-path/no-model
   * fallback message (so the UI only stamps "AI-generated" when it really is).
   */
  aiGenerated: boolean;
}

/** Aggregate path confidence at/below this reads as "weak/uncertain". */
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

// ── Injectable boundaries ──────────────────────────────────────────────────────

/** Runs the narrative LLM over a prompt and returns its prose. */
export interface NarrativeLlm {
  generate(prompt: string): Promise<string>;
}

/** The dependencies the orchestration needs, all injectable for tests. */
export interface ConnectionNarrativeDeps {
  /** shortest-path traversal of the shared graph (default: graph-store.findPath). */
  findPath(fromCsid: string, toCsid: string): Promise<GraphPath | null>;
  /** the LLM that writes the prose (default: live Gemini). */
  llm: NarrativeLlm;
  /**
   * optional Datalog inference over the two endpoints; returns any inferred
   * facts (default: none). Failures must degrade to `[]`, never throw.
   */
  inferFacts?(fromCsid: string, toCsid: string): Promise<DatalogFact[]>;
}

// ── Evidence extraction (pure) ─────────────────────────────────────────────────

function nodeLabel(node: GraphNode | undefined, csid: string): string {
  if (!node) return csid;
  return node.name && node.name.trim() ? node.name : csid;
}

/** Read the first non-empty string among the given property keys. */
function firstString(
  props: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Read a 0..1 number among the given property keys, if any. */
function firstNumber(
  props: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Humanize a relationship token: `DESCENDS_FROM`/`descends-from` → `descends from`. */
export function humanizeRelationship(type: string): string {
  return type
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Turn a graph path into ordered, provenance-bearing evidence. Pure. Each edge
 * becomes one {@link ConnectionEvidence}, oriented along the path direction, with
 * its source/source_url/confidence lifted out of the edge (or endpoint node)
 * properties.
 */
export function extractPathEvidence(path: GraphPath): ConnectionEvidence[] {
  const nodeByCsid = new Map<string, GraphNode>();
  for (const n of path.nodes) nodeByCsid.set(n.csid, n);

  // Orient each edge so it reads forward along the node order.
  const order = new Map<string, number>();
  path.nodes.forEach((n, i) => order.set(n.csid, i));

  return path.edges.map((edge) => {
    const aIdx = order.get(edge.startCsid) ?? 0;
    const bIdx = order.get(edge.endCsid) ?? 0;
    const forward = aIdx <= bIdx;
    const fromCsid = forward ? edge.startCsid : edge.endCsid;
    const toCsid = forward ? edge.endCsid : edge.startCsid;
    const rel = humanizeRelationship(edge.type);
    const fromLabel = nodeLabel(nodeByCsid.get(fromCsid), fromCsid);
    const toLabel = nodeLabel(nodeByCsid.get(toCsid), toCsid);

    const props = edge.properties ?? {};
    const source = firstString(props, ["source", "source_query", "citation"]);
    const sourceUrl = firstString(props, ["source_url", "url"]);
    const confidence =
      typeof edge.weight === "number"
        ? edge.weight
        : firstNumber(props, ["confidence", "weight"]);

    const evidence: ConnectionEvidence = {
      kind: "edge",
      statement: `${fromLabel} — ${rel} — ${toLabel}`,
      fromCsid,
      toCsid,
      relationship: edge.type,
    };
    if (source !== undefined) evidence.source = source;
    if (sourceUrl !== undefined) evidence.sourceUrl = sourceUrl;
    if (confidence !== undefined) {
      evidence.confidence = Math.max(0, Math.min(1, confidence));
    }
    return evidence;
  });
}

/**
 * Aggregate 0..1 confidence for a path: the **product** of each edge's
 * confidence (a chain is only as trustworthy as its weakest, compounding links).
 * Edges without an explicit confidence contribute a neutral prior so an
 * unweighted graph still yields a usable (if hedged) score. Pure.
 */
export function pathConfidence(evidence: ConnectionEvidence[]): number {
  if (evidence.length === 0) return 0;
  const NEUTRAL_PRIOR = 0.7;
  let product = 1;
  for (const e of evidence) {
    const c = typeof e.confidence === "number" ? e.confidence : NEUTRAL_PRIOR;
    product *= Math.max(0, Math.min(1, c));
  }
  return Math.round(product * 1000) / 1000;
}

// ── Prompt building (pure) ──────────────────────────────────────────────────────

/**
 * Build the grounding prompt for the LLM. It hands the model ONLY the extracted
 * evidence and instructs it to explain the link strictly from that evidence,
 * cite each step, and hedge when the connection is weak — so the prose cannot
 * outrun the graph.
 */
export function buildNarrativePrompt(
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  evidence: ConnectionEvidence[],
  facts: DatalogFact[],
  confidence: number,
): string {
  const fromName = from.name?.trim() || from.csid;
  const toName = to.name?.trim() || to.csid;

  const evidenceLines = evidence.map((e, i) => {
    const parts = [`${i + 1}. ${e.statement}`];
    if (typeof e.confidence === "number") parts.push(`(confidence ${e.confidence.toFixed(2)})`);
    if (e.source) parts.push(`[source: ${e.source}]`);
    return parts.join(" ");
  });
  const factLines = facts.map((f, i) => `D${i + 1}. ${f.statement} [inferred: ${f.relation}]`);

  const evidenceBlock =
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "(no direct edges)";
  const factBlock = factLines.length > 0 ? `\n\nInferred (Datalog) facts:\n${factLines.join("\n")}` : "";

  return `You are explaining how two cultural/historical entities are connected, for a curious but careful reader.

Entity A: ${fromName}
Entity B: ${toName}

Below is the ONLY evidence you may use — a chain of relationships drawn from a knowledge graph, in order from A to B. Do not introduce any fact, entity, date, or claim that is not present in this evidence. If the evidence is thin or indirect, say so plainly.

Graph path (A → B):
${evidenceBlock}${factBlock}

Aggregate confidence in this connection: ${confidence.toFixed(2)} (0 = speculative, 1 = well-attested).

Write 2–4 sentences explaining the connection between A and B. Walk the chain in order. Reference the intermediate steps so the reader can follow the path. If the aggregate confidence is low (< 0.4), explicitly caveat that the link is tentative. Do not fabricate. Return prose only — no preamble, no markdown headings.`;
}

// ── Datalog fact rendering (pure) ──────────────────────────────────────────────

/** Convert Datalog inference rows into human-readable facts. Pure. */
export function factsToEvidence(facts: DatalogFact[]): ConnectionEvidence[] {
  return facts.map((f) => {
    const evidence: ConnectionEvidence = {
      kind: "datalog",
      statement: f.statement,
      relationship: f.relation,
    };
    if (f.csids && f.csids.length >= 1) evidence.fromCsid = f.csids[0];
    if (f.csids && f.csids.length >= 2) evidence.toCsid = f.csids[f.csids.length - 1];
    return evidence;
  });
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/**
 * Explain the connection between two entities. Traverses the graph, augments
 * with Datalog inference, and generates a grounded, sourced narrative.
 *
 * When no path (and no inferred fact) is found, returns an honest, non-AI
 * "no connection" result WITHOUT calling the LLM — the model is never asked to
 * invent a link the graph doesn't support.
 */
export async function explainConnection(
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  deps: ConnectionNarrativeDeps,
): Promise<ConnectionNarrative> {
  const [path, facts] = await Promise.all([
    deps.findPath(from.csid, to.csid),
    deps.inferFacts ? safeInfer(deps.inferFacts, from.csid, to.csid) : Promise.resolve([]),
  ]);

  const pathEvidence = path ? extractPathEvidence(path) : [];
  const factEvidence = factsToEvidence(facts);
  const evidence = [...pathEvidence, ...factEvidence];
  const confidence = pathConfidence(pathEvidence);
  const pathLength = path ? path.length : 0;

  // No path AND no inferred fact → honest, non-AI answer. Don't call the LLM.
  if (evidence.length === 0) {
    return {
      from,
      to,
      connected: false,
      explanation:
        `No connection was found between ${from.name?.trim() || from.csid} and ` +
        `${to.name?.trim() || to.csid} in the shared graph. This does not mean none ` +
        `exists — only that the current data records no path between them.`,
      evidence: [],
      confidence: 0,
      lowConfidence: true,
      pathLength: 0,
      aiGenerated: false,
    };
  }

  const prompt = buildNarrativePrompt(from, to, pathEvidence, facts, confidence);
  const prose = (await deps.llm.generate(prompt)).trim();

  return {
    from,
    to,
    connected: true,
    explanation: prose,
    evidence,
    confidence,
    lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD,
    pathLength,
    aiGenerated: true,
  };
}

/** Run an inference callback, swallowing any failure into `[]` (graceful). */
async function safeInfer(
  infer: (a: string, b: string) => Promise<DatalogFact[]>,
  from: string,
  to: string,
): Promise<DatalogFact[]> {
  try {
    return await infer(from, to);
  } catch {
    return [];
  }
}

// ── Live (Gemini) LLM implementation ────────────────────────────────────────────

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    explanation: {
      type: SchemaType.STRING,
      description: "2–4 sentence grounded prose explanation of the connection.",
    },
  },
  required: ["explanation"],
};

/** Live LLM using the same Gemini client as the text extractor / image analyzer. */
export const liveNarrativeLlm: NarrativeLlm = {
  async generate(prompt: string): Promise<string> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for narrative generation",
      );
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const result = await model.generateContent([prompt]);
    const raw = JSON.parse(result.response.text()) as { explanation?: unknown };
    const explanation = typeof raw.explanation === "string" ? raw.explanation : "";
    if (!explanation.trim()) {
      throw new Error("empty narrative from the model");
    }
    return explanation;
  },
};

// Exported for testing.
export { RESPONSE_SCHEMA };
