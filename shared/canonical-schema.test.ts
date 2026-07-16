import { describe, it, expect } from "vitest";
import {
  CANONICAL_SCHEMA,
  assertValidCanonicalSchema,
  nodeHeaderRow,
  edgeHeaderRow,
  nodeProvenanceColumns,
  edgeProvenanceColumns,
  nodeTypeByName,
  edgeTypeByName,
  nodeLabels,
  edgeTypeTokens,
} from "./canonical-schema.ts";

// The node/edge type vocabulary the convergence PRD (US-001) ratifies. Kept
// here as an independent copy so a silent edit to canonical-schema.json trips.
const EXPECTED_NODE_TYPES = [
  "language",
  "language-family",
  "writing-system",
  "culture",
  "archaeological-culture",
  "urheimat-hypothesis",
  "religion",
  "deity",
  "myth-motif",
  "art-tradition",
  "literary-tradition",
  "cuisine",
  "ingredient",
  "trade-good",
  "battle",
  "place",
  "migration-route",
];

const EXPECTED_EDGE_TYPES = [
  "descended-from",
  "split-from",
  "merged-with",
  "influenced-by",
  "conquered-by",
  "absorbed-into",
  "spoken-in",
  "located-in",
  "contemporary-with",
  "part-of-period",
  "borrowed-from",
  "cognate-with",
  "derived-from",
  "syncretized-with",
];

describe("canonical schema contract (US-001)", () => {
  it("is well-formed", () => {
    expect(() => assertValidCanonicalSchema()).not.toThrow();
  });

  it("declares exactly the ratified node types", () => {
    expect(CANONICAL_SCHEMA.nodeTypes.map((t) => t.name)).toEqual(
      EXPECTED_NODE_TYPES,
    );
  });

  it("declares exactly the ratified edge types", () => {
    expect(CANONICAL_SCHEMA.edgeTypes.map((t) => t.name)).toEqual(
      EXPECTED_EDGE_TYPES,
    );
  });

  it("gives every node type a unique PascalCase :LABEL", () => {
    const labels = nodeLabels();
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });

  it("gives every edge type a unique SCREAMING_SNAKE :TYPE token", () => {
    const tokens = edgeTypeTokens();
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it("uses a tab delimiter and Neo4j-import structural headers", () => {
    expect(CANONICAL_SCHEMA.delimiter).toBe("\t");
    expect(nodeHeaderRow().split("\t")[0]).toBe("csid:ID");
    expect(nodeHeaderRow()).toContain(":LABEL");
    const edgeCells = edgeHeaderRow().split("\t");
    expect(edgeCells.slice(0, 3)).toEqual([":START_ID", ":END_ID", ":TYPE"]);
  });

  it("carries typed Neo4j suffixes on numeric columns", () => {
    const nodeHeaders = CANONICAL_SCHEMA.node.columns.map((c) => c.header);
    expect(nodeHeaders).toContain("time_start:int");
    expect(nodeHeaders).toContain("lat:float");
    expect(nodeHeaders).toContain("confidence:float");
    expect(CANONICAL_SCHEMA.edge.columns.map((c) => c.header)).toContain(
      "confidence:float",
    );
  });

  it("mandates the required provenance columns on nodes and edges (incl. v1.1 license)", () => {
    // v1.1.0 adds a per-record SPDX `license` to the mandatory provenance set.
    const required = [
      "source",
      "source_url",
      "retrieved_at",
      "confidence",
      "license",
    ];
    expect(nodeProvenanceColumns()).toEqual(required);
    expect(edgeProvenanceColumns()).toEqual(required);
    for (const family of [
      CANONICAL_SCHEMA.node.columns,
      CANONICAL_SCHEMA.edge.columns,
    ]) {
      for (const name of required) {
        expect(family.find((c) => c.field === name)?.required).toBe(true);
      }
    }
  });

  it("is schema v1.1.0 with edge citations + per-record license (US-003)", () => {
    expect(CANONICAL_SCHEMA.version).toBe("1.1.0");
    // Edges now carry a source_query citation column (role provenance, optional).
    const edgeSourceQuery = CANONICAL_SCHEMA.edge.columns.find(
      (c) => c.field === "source_query",
    );
    expect(edgeSourceQuery?.role).toBe("provenance");
    expect(edgeSourceQuery?.required).toBe(false);
    // Both families carry an SPDX `license` provenance column.
    for (const family of [
      CANONICAL_SCHEMA.node.columns,
      CANONICAL_SCHEMA.edge.columns,
    ]) {
      const license = family.find((c) => c.field === "license");
      expect(license?.role).toBe("provenance");
      expect(license?.type).toBe("string");
      expect(license?.required).toBe(true);
    }
  });

  it("retains the Pinakes id as an alias column on both families", () => {
    expect(CANONICAL_SCHEMA.idScheme.aliasColumn).toBe("pinakes_id");
    expect(
      CANONICAL_SCHEMA.node.columns.find((c) => c.field === "pinakes_id")
        ?.role,
    ).toBe("alias");
    expect(
      CANONICAL_SCHEMA.edge.columns.find((c) => c.field === "pinakes_id")
        ?.role,
    ).toBe("alias");
  });

  it("names the reconciliation anchors", () => {
    expect(CANONICAL_SCHEMA.idScheme.primaryKey).toBe("csid");
    expect(CANONICAL_SCHEMA.idScheme.anchors.all).toContain("wikidata_qid");
    expect(CANONICAL_SCHEMA.idScheme.anchors.language).toContain(
      "language_code",
    );
    expect(CANONICAL_SCHEMA.idScheme.anchors.place).toEqual(
      expect.arrayContaining(["pleiades_id", "tgn_id"]),
    );
  });

  it("resolves node/edge types by name", () => {
    expect(nodeTypeByName("language")?.label).toBe("Language");
    expect(edgeTypeByName("spoken-in")?.type).toBe("SPOKEN_IN");
    expect(nodeTypeByName("nonexistent")).toBeUndefined();
  });

  it("throws when a provenance column is not declared", () => {
    const broken = structuredClone(CANONICAL_SCHEMA);
    (broken.provenanceColumns.node as string[]).push("not_a_column");
    expect(() => assertValidCanonicalSchema(broken)).toThrow(/not_a_column/);
  });
});
