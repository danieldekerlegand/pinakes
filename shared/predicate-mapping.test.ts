import { describe, it, expect } from "vitest";
import {
  PREDICATE_MAPPING,
  LOCAL_ONLY,
  assertValidPredicateMapping,
  predicateMappingProject,
  relationsForProject,
  portabilityClassIds,
  isLocalOnly,
  localOnlyRelations,
  idSpaceForRef,
  canonicalTemporalField,
  type PredicateMappingRegistry,
  type RelationMapping,
} from "./predicate-mapping";

/** Deep-clone the live registry so a test can mutate one field in isolation. */
function cloneRegistry(): PredicateMappingRegistry {
  return JSON.parse(JSON.stringify(PREDICATE_MAPPING)) as PredicateMappingRegistry;
}

describe("predicate-mapping registry", () => {
  it("is well-formed and canonical-type-total (the live registry validates)", () => {
    expect(() => assertValidPredicateMapping()).not.toThrow();
  });

  it("registers the analyzer project encoding the media-bridge mapping spec Appendix A", () => {
    const analyzer = predicateMappingProject("analyzer");
    expect(analyzer).toBeDefined();
    expect(analyzer?.sourceDoc).toMatch(/Appendix A/i);
    // Appendix A has 11 numbered relation rows.
    expect(relationsForProject("analyzer")).toHaveLength(11);
  });

  it("recognizes the local-only portability class (the privacy invariant)", () => {
    expect(portabilityClassIds()).toContain(LOCAL_ONLY);
    const localOnly = localOnlyRelations("analyzer");
    // asset_technical / says / reads / scene / shows are personal-media, local-only.
    expect(localOnly.length).toBeGreaterThan(0);
    for (const rel of localOnly) {
      expect(isLocalOnly(rel)).toBe(true);
      expect(rel.portability).toContain(LOCAL_ONLY);
    }
    // A horn-safe-only relation (derived_from) is NOT local-only.
    const derivedFrom = relationsForProject("analyzer").find((r) => r.canonicalType === "derived-from");
    expect(derivedFrom).toBeDefined();
    expect(isLocalOnly(derivedFrom as RelationMapping)).toBe(false);
  });

  it("encodes the sha256:/cs: id-space rules and t_start/t_end temporal map", () => {
    expect(idSpaceForRef("sha256:deadbeef")?.nodeType).toBe("asset");
    expect(idSpaceForRef("cs:language:Q123")?.canonicalKind).toBe("entity");
    expect(idSpaceForRef("run:abc")?.canonicalKind).toBe("provenance");
    expect(idSpaceForRef("no-prefix")).toBeUndefined();
    expect(canonicalTemporalField("t_start")).toBe("time_start");
    expect(canonicalTemporalField("t_end")).toBe("time_end");
  });

  it("maps every analyzer relation to a known portability class", () => {
    const known = new Set(portabilityClassIds());
    for (const rel of relationsForProject("analyzer")) {
      for (const p of rel.portability) expect(known.has(p)).toBe(true);
    }
  });

  it("resolves non-pending canonical types against the live schema (totality)", () => {
    // derived-from (edge) is an EXISTING canonical type carried non-pending.
    const derivedFrom = relationsForProject("analyzer").find((r) => r.id === 7);
    expect(derivedFrom?.pending).toBe(false);
    expect(derivedFrom?.canonicalType).toBe("derived-from");
    // asset / depicts are v1.3 additions carried as pending.
    const shows = relationsForProject("analyzer").find((r) => r.id === 2);
    expect(shows?.pending).toBe(true);
    expect(shows?.canonicalType).toBe("depicts");
  });

  it("rejects a relation whose non-pending canonical type does not resolve", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.analyzer.relations.find((r) => r.id === 7) as RelationMapping;
    (rel as { canonicalType: string }).canonicalType = "not-a-real-edge";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/does not resolve/i);
  });

  it("rejects a pending relation whose canonical type already resolves (stale flag)", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.analyzer.relations.find((r) => r.id === 2) as RelationMapping;
    // Point a pending relation at an existing canonical edge — the flag is now stale.
    (rel as { canonicalType: string }).canonicalType = "located-in";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/flip pending to false/i);
  });

  it("rejects a pending canonical type not declared in pendingSchemaAdditions", () => {
    const bad = cloneRegistry();
    // Keep `asset` declared (the sha256: id-space needs it) but drop the pending
    // edge types, so a pending `depicts`/`mentions` relation trips the relation check.
    bad.projects.analyzer.pendingSchemaAdditions = {
      targetVersion: "1.3.0",
      note: "x",
      nodeTypes: ["asset"],
      edgeTypes: [],
    };
    expect(() => assertValidPredicateMapping(bad)).toThrow(/not listed in pendingSchemaAdditions/i);
  });

  it("rejects an unknown portability class reference", () => {
    const bad = cloneRegistry();
    (bad.projects.analyzer.relations[0] as { portability: string[] }).portability = ["made-up"];
    expect(() => assertValidPredicateMapping(bad)).toThrow(/unknown portability class/i);
  });

  it("rejects a duplicate relation id within a project", () => {
    const bad = cloneRegistry();
    (bad.projects.analyzer.relations[1] as { id: number }).id = bad.projects.analyzer.relations[0].id;
    expect(() => assertValidPredicateMapping(bad)).toThrow(/duplicate id/i);
  });

  it("rejects a non-type kind that carries a canonical type", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.analyzer.relations.find((r) => r.canonicalKind === "derived-rule") as RelationMapping;
    (rel as { canonicalType: string }).canonicalType = "asset";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/must not name a canonical type/i);
  });
});
