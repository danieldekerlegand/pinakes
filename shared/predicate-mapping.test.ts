import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  PREDICATE_MAPPING,
  KOINE_REGISTRY_PATH,
  LOCAL_ONLY,
  assertValidPredicateMapping,
  predicateMappingProject,
  relationsForProject,
  dialectTierIds,
  egressClassIds,
  isLocalOnly,
  localOnlyRelations,
  idSpaceForRef,
  canonicalTemporalField,
  externalPredicatesForProject,
  unverifiedPredicates,
  type PredicateMappingRegistry,
  type RelationMapping,
} from "./predicate-mapping";
import { KGP_CORE_RELATIONS, KGP_DOMAIN_RELATIONS } from "./kgp";
import {
  parseRelationsTsv,
  diffVocabulary,
  formatSignatureDrifts,
  readKoineVocabulary,
} from "../scripts/regen-registry-mirror";

/** Deep-clone the live registry so a test can mutate one field in isolation. */
function cloneRegistry(): PredicateMappingRegistry {
  return JSON.parse(JSON.stringify(PREDICATE_MAPPING)) as PredicateMappingRegistry;
}

/** The koine checkout holding the authoritative registry (`KOINE_ROOT` overrides). */
const KOINE_ROOT = process.env.KOINE_ROOT ?? join(homedir(), "Development", "koine");
const KOINE_REGISTRY = join(KOINE_ROOT, KOINE_REGISTRY_PATH);
const hasKoine = existsSync(KOINE_REGISTRY);

/** Insimul's shipped Mongo ⇄ Prolog predicate catalog (`INSIMUL_ROOT` overrides). */
const INSIMUL_ROOT =
  process.env.INSIMUL_ROOT ?? join(homedir(), "Development", "workspace", "insimul-babylon");
const INSIMUL_PREDICATE_SCHEMA = join(
  INSIMUL_ROOT,
  "packages",
  "core",
  "src",
  "prolog",
  "predicate-schema.ts",
);
const hasInsimulCatalog = existsSync(INSIMUL_PREDICATE_SCHEMA);

describe("predicate-mapping registry", () => {
  it("is well-formed, canonical-type-total and relation-total (the live registry validates)", () => {
    expect(() => assertValidPredicateMapping()).not.toThrow();
  });

  it("declares koine as its canonical home and this copy as a generated mirror", () => {
    expect(PREDICATE_MAPPING.canonicalHome.repo).toBe("koine");
    expect(PREDICATE_MAPPING.canonicalHome.path).toBe(KOINE_REGISTRY_PATH);
    const mirror = PREDICATE_MAPPING.mirrors.find((m) => m.project === "pinakes");
    expect(mirror?.path).toBe("shared/predicate-mapping.json");
    expect(mirror?.mode).toBe("generated-mirror");
  });

  // Drift gate: the mirror is byte-derived from koine, never hand-edited. A correction
  // is upstreamed there (bumping registryVersion) and re-vendored — never forked here.
  it.skipIf(!hasKoine)("is byte-identical to the authoritative koine copy", () => {
    const vendored = readFileSync(resolve(import.meta.dirname, "predicate-mapping.json"), "utf8");
    expect(readFileSync(KOINE_REGISTRY, "utf8")).toBe(vendored);
  });

  // Second drift gate (US-2): the byte test above covers only the JSON mirror. `kgp.ts`'s
  // `KGP_CORE_RELATIONS` + `KGP_DOMAIN_RELATIONS` are a SECOND mirror ("vendored verbatim
  // from koine registry/relations.tsv") that no test gated — so a koine signature change
  // could drift unnoticed. This companion parses the four live TSVs and fails if any
  // vendored signature disagrees on arity / ordered argRoles / symmetric / tier.
  it.skipIf(!hasKoine)(
    "vendored kgp.ts vocabulary matches the live koine TSV signatures",
    () => {
      const { core, domain } = readKoineVocabulary(KOINE_ROOT);
      const drifts = [
        ...diffVocabulary(KGP_CORE_RELATIONS, core),
        ...diffVocabulary(KGP_DOMAIN_RELATIONS, domain),
      ];
      expect(drifts, formatSignatureDrifts(drifts)).toEqual([]);
    },
  );

  // Proof the gate BLOCKS on staleness (doesn't just skip): drive the same comparator with a
  // simulated koine change and assert it goes red with `npm run regen:registry-mirror` as the
  // remedy — never "hand-edit the mirror". Uses a synthetic TSV, so it runs without a koine
  // checkout too (the live companion above skips when the sibling repo is absent).
  it("a changed/added koine TSV signature turns the drift gate red, naming the regen remedy", () => {
    const staleTsv =
      "relation\tarity\targ_roles\tsymmetric\ttier\tdomain\tinverse\tdescription\n" +
      // `same_as` is vendored symmetric:true — koine flipping it (a signature change) drifts.
      "same_as\t2\ta|b\tfalse\tgrounding-only\tcore\t\tsimulated signature change\n" +
      // A brand-new upstream relation not yet re-vendored into kgp.ts is also drift.
      "brand_new_rel\t2\tx|y\tfalse\tgrounding-only\tcore\t\tadded upstream, not vendored\n";
    const drifts = diffVocabulary(KGP_CORE_RELATIONS, parseRelationsTsv(staleTsv, { core: true }));
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts.map((d) => d.relation)).toEqual(
      expect.arrayContaining(["same_as", "brand_new_rel"]),
    );
    const message = formatSignatureDrifts(drifts);
    expect(message).toContain("npm run regen:registry-mirror");
    expect(message).toMatch(/never hand-edit/i);
  });

  it("a koine registryVersion bump turns the byte gate red until a re-vendor", () => {
    const vendored = readFileSync(resolve(import.meta.dirname, "predicate-mapping.json"), "utf8");
    // Koine bumps 0.4.2 → 0.4.3 upstream; until `npm run regen:registry-mirror` re-vendors,
    // the authoritative copy no longer equals the byte-for-byte mirror.
    const bumped = vendored.replace(/"registryVersion": "0\.4\.2"/, '"registryVersion": "0.4.3"');
    expect(bumped).not.toBe(vendored); // the bump really changed the authoritative source…
    expect(vendored).not.toBe(bumped); // …so the byte-identical gate above would be red.
  });

  it("registers the analyzer project encoding the media-bridge mapping spec (Appendix A)", () => {
    const analyzer = predicateMappingProject("analyzer");
    expect(analyzer).toBeDefined();
    expect(analyzer?.sourceDoc).toMatch(/Appendix A/i);
    // Appendix A has 11 numbered relation rows.
    expect(relationsForProject("analyzer")).toHaveLength(11);
  });

  it("registers the insimul project encoding INSIMUL_SYNC_PLAN.md Appendix A", () => {
    const insimul = predicateMappingProject("insimul");
    expect(insimul).toBeDefined();
    expect(insimul?.sourceDoc).toMatch(/INSIMUL_SYNC_PLAN\.md Appendix A/);
    // Appendix A's 14 rows split into one entry per canonicalKind (a row bundling a node
    // with its edges becomes several), plus one predicate-schema-only entry: 19 entries,
    // each naming the `sourceRow` it derives from.
    const relations = relationsForProject("insimul");
    expect(relations).toHaveLength(19);
    for (const rel of relations) expect(rel.sourceRow).toBeDefined();
    const rows = new Set(relations.map((r) => r.sourceRow).filter((r) => typeof r === "number"));
    expect([...rows].sort((a, b) => (a as number) - (b as number))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it("splits dialect from egress — local-only is an egress class, not a fourth tier", () => {
    expect(dialectTierIds()).toEqual(["grounding-only", "horn-safe", "full-prolog"]);
    expect(dialectTierIds()).not.toContain(LOCAL_ONLY);
    expect(egressClassIds()).toContain(LOCAL_ONLY);
    expect(egressClassIds()).toContain("exportable");
  });

  it("recognizes the local-only egress class (the privacy invariant)", () => {
    const localOnly = [...localOnlyRelations("analyzer"), ...localOnlyRelations("insimul")];
    // asset_technical / says / reads / scene / shows are personal-media, local-only.
    expect(localOnly.length).toBeGreaterThan(0);
    for (const rel of localOnly) {
      expect(isLocalOnly(rel)).toBe(true);
      expect(rel.egress).toBe(LOCAL_ONLY);
    }
    // Insimul's CEFR/chat entry is a real person's data: local-only, crossing neither way.
    const cefr = relationsForProject("insimul").find((r) => r.canonicalKind === "none");
    expect(cefr?.egress).toBe(LOCAL_ONLY);
    expect(cefr?.direction).toBe("none");
    // A horn-safe relation (derived_from) is exportable, not local-only.
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

  it("scopes insimul ids to one world — they are not KINP ids and carry no prefix", () => {
    const idSpace = predicateMappingProject("insimul")?.idSpace;
    expect(idSpace?.prefix).toBeNull();
    expect(String(idSpace?.rule)).toMatch(/NOT across worlds/i);
  });

  it("maps every relation to a known dialect tier and egress class", () => {
    const dialects = new Set(dialectTierIds());
    const egress = new Set(egressClassIds());
    for (const project of Object.keys(PREDICATE_MAPPING.projects)) {
      for (const rel of relationsForProject(project)) {
        if (rel.dialect !== null) expect(dialects.has(rel.dialect)).toBe(true);
        expect(egress.has(rel.egress)).toBe(true);
      }
    }
  });

  it("names a koine relation exactly when the mapping crosses as a claim", () => {
    for (const project of Object.keys(PREDICATE_MAPPING.projects)) {
      for (const rel of relationsForProject(project)) {
        const crossesAsClaim = rel.canonicalKind === "edge" || rel.canonicalKind === "derived-rule";
        expect(rel.koineRelations.length > 0).toBe(crossesAsClaim);
      }
    }
    // The insimul social edges normalize to the koine `soc:` domain vocabulary.
    const byType = (type: string) =>
      relationsForProject("insimul").find((r) => r.canonicalType === type);
    expect(byType("parent-of")?.koineRelations).toEqual(["soc:parent_of"]);
    expect(byType("spouse-of")?.koineRelations).toEqual(["soc:spouse_of"]);
    expect(byType("caused-by")?.koineRelations).toEqual(["caused_by"]);
  });

  it("resolves the now-landed canonical types against the live schema (totality)", () => {
    // derived-from (edge) is an EXISTING canonical type carried non-pending.
    const derivedFrom = relationsForProject("analyzer").find((r) => r.id === 7);
    expect(derivedFrom?.pending).toBe(false);
    expect(derivedFrom?.canonicalType).toBe("derived-from");
    // asset / depicts / mentions landed in canonical schema v1.2 (analyzer-bridge US-003),
    // so their relations are now non-pending and resolve against the live schema.
    const shows = relationsForProject("analyzer").find((r) => r.id === 2);
    expect(shows?.pending).toBe(false);
    expect(shows?.canonicalType).toBe("depicts");
    const refersTo = relationsForProject("analyzer").find((r) => r.id === 8);
    expect(refersTo?.pending).toBe(false);
    expect(refersTo?.canonicalTypes).toEqual(["depicts", "mentions"]);
    // Nothing remains pending for analyzer now that the v1.2 additions have landed.
    expect(relationsForProject("analyzer").every((r) => !r.pending)).toBe(true);
  });

  it("clears insimul's pending flags now the v1.3 Bridge-2 additions have landed", () => {
    const insimul = predicateMappingProject("insimul");
    // The checklist emptied when canonical schema v1.3.0 landed the seven types
    // (insimul-bridge US-003); `targetVersion` stays as the schema that closed it.
    expect(insimul?.pendingSchemaAdditions?.targetVersion).toBe("1.3.0");
    expect(insimul?.pendingSchemaAdditions?.nodeTypes).toEqual([]);
    expect(insimul?.pendingSchemaAdditions?.edgeTypes).toEqual([]);
    // Nothing remains pending for insimul either — the Bridge-2 entries (9-15)
    // resolve against `shared/canonical-schema.json` like every other entry.
    expect(relationsForProject("insimul").every((r) => !r.pending)).toBe(true);
    for (const id of [9, 10, 11, 12, 13, 14, 15]) {
      expect(relationsForProject("insimul").find((r) => r.id === id)?.pending).toBe(false);
    }
    // Bridge-1 grounding types (culture / place / language / deity / cuisine / myth-motif,
    // located-in / descended-from) already resolved, so they were never pending.
    const groundingSeeds = relationsForProject("insimul").filter((r) => r.direction === "LS->IN");
    expect(groundingSeeds.length).toBeGreaterThan(0);
    expect(groundingSeeds.every((r) => !r.pending)).toBe(true);
    // `settlement` was a draft convenience: the canonical node type is `place`.
    expect(relationsForProject("insimul").find((r) => r.sourceRow === 2)?.canonicalType).toBe("place");
  });

  // "Unknown predicates are allowed but flagged as unverified": the registry is authored
  // partly from a design draft, so a predicate the producer has not shipped is a flag for
  // a human, never a validation failure.
  it("allows an insimul predicate absent from the producer catalog, flagging it unverified", () => {
    const named = externalPredicatesForProject("insimul");
    expect(named.length).toBeGreaterThan(0);
    const withoutCatalog = unverifiedPredicates("insimul", []);
    expect(withoutCatalog).toHaveLength(named.length);
    // An empty catalog flags everything — and still validates.
    expect(() => assertValidPredicateMapping()).not.toThrow();
  });

  it.skipIf(!hasInsimulCatalog)(
    "verifies insimul predicates against the shipped predicate-schema.ts catalog",
    () => {
      const source = readFileSync(INSIMUL_PREDICATE_SCHEMA, "utf8");
      const catalog = [...source.matchAll(/\b([a-z][a-z0-9_]*)\/(\d+)/g)].map(
        (m) => `${m[1]}/${m[2]}`,
      );
      expect(catalog.length).toBeGreaterThan(0);
      const unverified = unverifiedPredicates("insimul", catalog);
      const named = externalPredicatesForProject("insimul");
      // Most predicates verify; the flagged remainder is engine state the Mongo ⇄ Prolog
      // catalog does not declare (`current_year/1`), which is allowed, not an error.
      expect(unverified.length).toBeLessThan(named.length / 2);
      for (const p of unverified) {
        expect(catalog).not.toContain(`${p.name}/${p.arity}`);
      }
    },
  );

  it("rejects a relation whose non-pending canonical type does not resolve", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.analyzer.relations.find((r) => r.id === 7) as RelationMapping;
    (rel as { canonicalType: string }).canonicalType = "not-a-real-edge";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/does not resolve/i);
  });

  it("rejects a pending relation whose canonical type already resolves (stale flag)", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.analyzer.relations.find((r) => r.id === 2) as RelationMapping;
    // depicts now resolves in the v1.2 schema, so marking its relation pending is stale.
    (rel as { pending: boolean }).pending = true;
    expect(() => assertValidPredicateMapping(bad)).toThrow(/flip pending to false/i);
  });

  it("rejects a pending canonical type not declared in pendingSchemaAdditions", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.analyzer.relations.find((r) => r.id === 2) as RelationMapping;
    // A relation pending on a type that neither resolves nor is a declared addition
    // (analyzer's pendingSchemaAdditions is now empty) trips the relation check.
    (rel as { pending: boolean }).pending = true;
    (rel as { canonicalType: string }).canonicalType = "not-yet-a-real-edge";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/not listed in pendingSchemaAdditions/i);
  });

  it("rejects an unknown egress class reference", () => {
    const bad = cloneRegistry();
    (bad.projects.analyzer.relations[0] as { egress: string }).egress = "made-up";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/unknown egress class/i);
  });

  it("rejects an unknown dialect tier reference", () => {
    const bad = cloneRegistry();
    (bad.projects.insimul.relations[0] as { dialect: string }).dialect = "datalog-ish";
    expect(() => assertValidPredicateMapping(bad)).toThrow(/unknown dialect tier/i);
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

  it("rejects a claim-kind mapping that names no koine relation", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.insimul.relations.find((r) => r.canonicalType === "parent-of") as RelationMapping;
    (rel as { koineRelations: string[] }).koineRelations = [];
    expect(() => assertValidPredicateMapping(bad)).toThrow(/names no koine relation/i);
  });

  it("rejects a koine relation the mapping coined instead of adding to the TSV", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.insimul.relations.find((r) => r.canonicalType === "caused-by") as RelationMapping;
    (rel as { koineRelations: string[] }).koineRelations = ["invented_here"];
    expect(() => assertValidPredicateMapping(bad)).toThrow(/not in the shared vocabulary/i);
  });

  it("rejects a koine relation in a domain pinakes does not speak", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.insimul.relations.find((r) => r.canonicalType === "spouse-of") as RelationMapping;
    (rel as { koineRelations: string[] }).koineRelations = ["mystery:spouse_of"];
    expect(() => assertValidPredicateMapping(bad)).toThrow(/not in the shared vocabulary/i);
  });

  it("rejects a non-claim kind that names a koine relation", () => {
    const bad = cloneRegistry();
    const rel = bad.projects.insimul.relations.find((r) => r.canonicalKind === "provenance") as RelationMapping;
    (rel as { koineRelations: string[] }).koineRelations = ["caused_by"];
    expect(() => assertValidPredicateMapping(bad)).toThrow(/must not name a koine relation/i);
  });
});
