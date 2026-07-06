import { describe, it, expect, vi } from "vitest";
import type { GraphPath } from "./graph-store";
import {
  explainConnection,
  extractPathEvidence,
  pathConfidence,
  buildNarrativePrompt,
  factsToEvidence,
  humanizeRelationship,
  LOW_CONFIDENCE_THRESHOLD,
  type ConnectionNarrativeDeps,
  type DatalogFact,
} from "./connection-narrative";

// ── Fixtures ────────────────────────────────────────────────────────────────

function node(csid: string, name: string) {
  return { csid, labels: ["Entity"], name, properties: {} };
}

/** A 3-node path: Spanish → Latin → PIE, with per-edge provenance. */
const PATH: GraphPath = {
  from: node("cs:language:spa", "Spanish"),
  to: node("cs:language:pie", "Proto-Indo-European"),
  nodes: [
    node("cs:language:spa", "Spanish"),
    node("cs:language:lat", "Latin"),
    node("cs:language:pie", "Proto-Indo-European"),
  ],
  edges: [
    {
      id: "e1",
      type: "DESCENDS_FROM",
      startCsid: "cs:language:spa",
      endCsid: "cs:language:lat",
      weight: 0.9,
      properties: { source: "Ethnologue", source_url: "https://ethnologue.com/spa" },
    },
    {
      id: "e2",
      type: "DESCENDS_FROM",
      startCsid: "cs:language:lat",
      endCsid: "cs:language:pie",
      weight: 0.8,
      properties: { source: "Comparative method" },
    },
  ],
  length: 2,
};

const okLlm = { generate: vi.fn(async () => "Spanish descends from Latin, which descends from Proto-Indo-European.") };

function deps(over: Partial<ConnectionNarrativeDeps> = {}): ConnectionNarrativeDeps {
  return {
    findPath: vi.fn(async () => PATH),
    llm: { generate: vi.fn(async () => "narrative") },
    ...over,
  };
}

// ── humanizeRelationship ──────────────────────────────────────────────────────

describe("humanizeRelationship", () => {
  it("normalizes tokens to lowercase words", () => {
    expect(humanizeRelationship("DESCENDS_FROM")).toBe("descends from");
    expect(humanizeRelationship("located-in")).toBe("located in");
  });
});

// ── extractPathEvidence ───────────────────────────────────────────────────────

describe("extractPathEvidence", () => {
  it("emits one oriented, provenance-bearing evidence per edge", () => {
    const evidence = extractPathEvidence(PATH);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      kind: "edge",
      statement: "Spanish — descends from — Latin",
      fromCsid: "cs:language:spa",
      toCsid: "cs:language:lat",
      relationship: "DESCENDS_FROM",
      source: "Ethnologue",
      sourceUrl: "https://ethnologue.com/spa",
      confidence: 0.9,
    });
    expect(evidence[1].source).toBe("Comparative method");
  });

  it("re-orients an edge stored against the path direction", () => {
    const reversed: GraphPath = {
      ...PATH,
      edges: [
        // stored lat → spa but the path runs spa → lat
        { id: "e1", type: "DESCENDS_FROM", startCsid: "cs:language:lat", endCsid: "cs:language:spa", properties: {} },
        PATH.edges[1],
      ],
    };
    const evidence = extractPathEvidence(reversed);
    expect(evidence[0].fromCsid).toBe("cs:language:spa");
    expect(evidence[0].toCsid).toBe("cs:language:lat");
  });
});

// ── pathConfidence ────────────────────────────────────────────────────────────

describe("pathConfidence", () => {
  it("is the product of per-edge confidences (weakest link compounds)", () => {
    const evidence = extractPathEvidence(PATH);
    expect(pathConfidence(evidence)).toBeCloseTo(0.72, 3); // 0.9 * 0.8
  });

  it("uses a neutral prior for unweighted edges", () => {
    const evidence = extractPathEvidence({
      ...PATH,
      edges: [{ id: "e", type: "REL", startCsid: "cs:language:spa", endCsid: "cs:language:pie", properties: {} }],
    });
    expect(pathConfidence(evidence)).toBeCloseTo(0.7, 3);
  });

  it("is 0 for no evidence", () => {
    expect(pathConfidence([])).toBe(0);
  });
});

// ── buildNarrativePrompt ──────────────────────────────────────────────────────

describe("buildNarrativePrompt", () => {
  it("grounds the prompt in the evidence and forbids fabrication", () => {
    const evidence = extractPathEvidence(PATH);
    const prompt = buildNarrativePrompt(
      { csid: "cs:language:spa", name: "Spanish" },
      { csid: "cs:language:pie", name: "Proto-Indo-European" },
      evidence,
      [],
      0.72,
    );
    expect(prompt).toContain("Spanish");
    expect(prompt).toContain("Proto-Indo-European");
    expect(prompt).toContain("Spanish — descends from — Latin");
    expect(prompt).toMatch(/do not (introduce|fabricate)/i);
    expect(prompt).toContain("0.72");
  });

  it("includes inferred Datalog facts when present", () => {
    const facts: DatalogFact[] = [
      { relation: "ancestor", statement: "PIE is an ancestor of Spanish.", csids: ["cs:language:spa", "cs:language:pie"] },
    ];
    const prompt = buildNarrativePrompt(
      { csid: "cs:language:spa" },
      { csid: "cs:language:pie" },
      [],
      facts,
      0,
    );
    expect(prompt).toContain("Inferred (Datalog) facts");
    expect(prompt).toContain("PIE is an ancestor of Spanish.");
  });
});

// ── factsToEvidence ───────────────────────────────────────────────────────────

describe("factsToEvidence", () => {
  it("maps Datalog facts to datalog-kind evidence with endpoints", () => {
    const evidence = factsToEvidence([
      { relation: "ancestor", statement: "X is an ancestor of Y.", csids: ["cs:y", "cs:x"] },
    ]);
    expect(evidence[0]).toMatchObject({
      kind: "datalog",
      relationship: "ancestor",
      fromCsid: "cs:y",
      toCsid: "cs:x",
    });
  });
});

// ── explainConnection ─────────────────────────────────────────────────────────

describe("explainConnection", () => {
  const A = { csid: "cs:language:spa", name: "Spanish" };
  const B = { csid: "cs:language:pie", name: "Proto-Indo-European" };

  it("generates a grounded, AI-labelled narrative when a path exists", async () => {
    const d = deps({ llm: okLlm });
    okLlm.generate.mockClear();
    const result = await explainConnection(A, B, d);
    expect(result.connected).toBe(true);
    expect(result.aiGenerated).toBe(true);
    expect(result.evidence).toHaveLength(2);
    expect(result.confidence).toBeCloseTo(0.72, 3);
    expect(result.lowConfidence).toBe(false);
    expect(result.pathLength).toBe(2);
    expect(okLlm.generate).toHaveBeenCalledOnce();
  });

  it("returns an honest, non-AI answer and DOES NOT call the LLM when no path", async () => {
    const llm = { generate: vi.fn(async () => "should not run") };
    const result = await explainConnection(A, B, deps({ findPath: vi.fn(async () => null), llm }));
    expect(result.connected).toBe(false);
    expect(result.aiGenerated).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toMatch(/no connection was found/i);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it("flags lowConfidence when the aggregate path confidence is weak", async () => {
    const weakPath: GraphPath = {
      ...PATH,
      edges: [
        { id: "e", type: "MAYBE", startCsid: "cs:language:spa", endCsid: "cs:language:pie", weight: 0.3, properties: {} },
      ],
      nodes: [PATH.nodes[0], PATH.nodes[2]],
      length: 1,
    };
    const result = await explainConnection(A, B, deps({ findPath: vi.fn(async () => weakPath), llm: okLlm }));
    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(result.lowConfidence).toBe(true);
    expect(result.connected).toBe(true);
  });

  it("augments with Datalog facts and still answers when only a fact exists (no path)", async () => {
    const facts: DatalogFact[] = [
      { relation: "ancestor", statement: "PIE is an ancestor of Spanish.", csids: ["cs:language:spa", "cs:language:pie"] },
    ];
    const result = await explainConnection(
      A,
      B,
      deps({ findPath: vi.fn(async () => null), inferFacts: vi.fn(async () => facts), llm: okLlm }),
    );
    expect(result.connected).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].kind).toBe("datalog");
  });

  it("degrades gracefully when Datalog inference throws", async () => {
    const result = await explainConnection(
      A,
      B,
      deps({ llm: okLlm, inferFacts: vi.fn(async () => { throw new Error("swipl missing"); }) }),
    );
    // Path evidence still carries the result; the failed inference is swallowed.
    expect(result.connected).toBe(true);
    expect(result.evidence.every((e) => e.kind === "edge")).toBe(true);
  });
});
