import { describe, it, expect } from "vitest";

/**
 * Unit tests for the relationship-builder authoring service (US-003). Pure —
 * no fs / express. Covers canonical-vocabulary validation, self-edge + duplicate
 * rejection, serialization into the `cultural-lineages.tsv` row shape, and the
 * contribution mapping (provenance + queue shape).
 */

import {
  validateRelationshipEdge,
  serializeRelationshipEdge,
  relationshipEdgeToContribution,
  relationshipSummary,
  edgeKey,
  RELATIONSHIP_TYPE_OPTIONS,
  RELATIONSHIP_PROVENANCE,
  DEFAULT_RELATIONSHIP_CONFIDENCE,
  type RelationshipEdgeInput,
  type ExistingEdge,
} from "./relationship-edge";

const base: RelationshipEdgeInput = {
  sourceId: "latin",
  sourceName: "Latin",
  targetId: "french",
  targetName: "French",
  relationshipType: "descended-from",
  timeStart: 100,
  timeEnd: 900,
  confidence: 80,
};

describe("canonical relationship vocabulary", () => {
  it("exposes the shared canonical edge vocabulary (name + Neo4j token)", () => {
    const names = RELATIONSHIP_TYPE_OPTIONS.map((o) => o.name);
    expect(names).toContain("descended-from");
    expect(names).toContain("split-from");
    expect(names).toContain("influenced-by");
    const descended = RELATIONSHIP_TYPE_OPTIONS.find((o) => o.name === "descended-from");
    expect(descended?.token).toBe("DESCENDS_FROM");
  });
});

describe("validateRelationshipEdge", () => {
  it("accepts a well-formed edge between two distinct entities", () => {
    const result = validateRelationshipEdge(base, []);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires both endpoints", () => {
    const missingSource = validateRelationshipEdge({ ...base, sourceId: "" });
    expect(missingSource.valid).toBe(false);
    expect(missingSource.errors.some((e) => e.includes("sourceId"))).toBe(true);

    const missingTarget = validateRelationshipEdge({ ...base, targetId: "  " });
    expect(missingTarget.valid).toBe(false);
    expect(missingTarget.errors.some((e) => e.includes("targetId"))).toBe(true);
  });

  it("rejects a self edge (source === target)", () => {
    const result = validateRelationshipEdge({ ...base, targetId: "latin" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("self edge"))).toBe(true);
  });

  it("rejects a relationship type outside the canonical vocabulary", () => {
    const result = validateRelationshipEdge({ ...base, relationshipType: "made-up" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("relationshipType must be one of"))).toBe(true);
  });

  it("rejects an inverted time range", () => {
    const result = validateRelationshipEdge({ ...base, timeStart: 900, timeEnd: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("inverted range"))).toBe(true);
  });

  it("allows an open-ended (missing) time range", () => {
    const result = validateRelationshipEdge(
      { ...base, timeStart: null, timeEnd: null },
      [],
    );
    expect(result.valid).toBe(true);
  });

  it("rejects confidence outside 1..100", () => {
    expect(validateRelationshipEdge({ ...base, confidence: 0 }).valid).toBe(false);
    expect(validateRelationshipEdge({ ...base, confidence: 101 }).valid).toBe(false);
  });

  it("warns when confidence is omitted", () => {
    const { confidence: _omit, ...noConf } = base;
    const result = validateRelationshipEdge(noConf, []);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("confidence"))).toBe(true);
  });
});

describe("deduplication", () => {
  const existing: ExistingEdge[] = [
    { sourceId: "latin", targetId: "french", relationshipType: "descended-from" },
  ];

  it("rejects a duplicate (source, target, type) triple and flags duplicate", () => {
    const result = validateRelationshipEdge(base, existing);
    expect(result.valid).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.errors.some((e) => e.includes("already exists"))).toBe(true);
  });

  it("treats direction as significant — the reversed edge is not a duplicate", () => {
    const reversed = validateRelationshipEdge(
      { ...base, sourceId: "french", targetId: "latin" },
      existing,
    );
    expect(reversed.valid).toBe(true);
    expect(reversed.duplicate).toBeFalsy();
  });

  it("treats a different relationship type between the same pair as distinct", () => {
    const other = validateRelationshipEdge(
      { ...base, relationshipType: "influenced-by" },
      existing,
    );
    expect(other.valid).toBe(true);
  });

  it("dedup key is whitespace-insensitive on ids", () => {
    expect(edgeKey(" latin ", "french", "descended-from")).toBe(
      edgeKey("latin", " french ", "descended-from"),
    );
    const padded = validateRelationshipEdge(
      { ...base, sourceId: " latin ", targetId: " french " },
      existing,
    );
    expect(padded.duplicate).toBe(true);
  });
});

describe("serializeRelationshipEdge", () => {
  it("produces the cultural-lineages.tsv row shape with JSON cells", () => {
    const row = serializeRelationshipEdge({
      ...base,
      evidenceTypes: ["linguistic", "textual"],
      sources: [{ title: "Anthony 2007" }, { title: "Ringe 2006" }],
    });
    expect(row.source_id).toBe("latin");
    expect(row.target_id).toBe("french");
    expect(row.relationship_type).toBe("descended-from");
    expect(row.time_start).toBe(100);
    expect(row.time_end).toBe(900);
    expect(row.confidence).toBe(80);
    expect(JSON.parse(row.evidence_types)).toEqual(["linguistic", "textual"]);
    expect(JSON.parse(row.sources)).toEqual(["Anthony 2007", "Ringe 2006"]);
  });

  it("emits empty-string cells for a missing time range", () => {
    const row = serializeRelationshipEdge({ ...base, timeStart: null, timeEnd: null });
    expect(row.time_start).toBe("");
    expect(row.time_end).toBe("");
  });

  it("falls back to the id when no display name is given", () => {
    const row = serializeRelationshipEdge({
      sourceId: "a",
      targetId: "b",
      relationshipType: "split-from",
    });
    expect(row.source_name).toBe("a");
    expect(row.target_name).toBe("b");
    expect(row.confidence).toBe(DEFAULT_RELATIONSHIP_CONFIDENCE);
  });
});

describe("relationshipEdgeToContribution", () => {
  it("maps to a queue contribution with user-authored provenance", () => {
    const contrib = relationshipEdgeToContribution(base);
    expect(contrib.entityType).toBe("relationship");
    expect(contrib.action).toBe("add");
    expect(contrib.confidence).toBe(80);
    const data = contrib.entityData as Record<string, unknown>;
    expect(data.source).toBe(RELATIONSHIP_PROVENANCE);
    expect(data.sourceId).toBe("latin");
    expect(data.targetId).toBe("french");
    expect(data.relationshipType).toBe("descended-from");
    expect(data.serialized).toBeDefined();
  });

  it("supplies a default source citation when none is given", () => {
    const contrib = relationshipEdgeToContribution(base);
    expect(contrib.sources?.length).toBeGreaterThan(0);
    expect(contrib.sources?.[0].title).toBeTruthy();
  });
});

describe("relationshipSummary", () => {
  it("summarizes the edge with its canonical Neo4j token for confirmation", () => {
    const summary = relationshipSummary(base);
    expect(summary.sourceName).toBe("Latin");
    expect(summary.targetName).toBe("French");
    expect(summary.relationshipType).toBe("descended-from");
    expect(summary.relationshipToken).toBe("DESCENDS_FROM");
    expect(summary.timeStart).toBe(100);
    expect(summary.confidence).toBe(80);
  });
});
