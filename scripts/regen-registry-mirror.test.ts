import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  assertValidPredicateMapping,
  PREDICATE_MAPPING,
  relationsForProject,
} from "@contracts/predicate-mapping";
import { relationSignature } from "@contracts/kgp";
import {
  parseRelationsTsv,
  renderEntries,
  regenerateKgpSource,
  buildRegen,
  writeRegen,
  runCheck,
  readKoineSource,
  resolveKoineRoot,
  KGP_PATH,
  PREDICATE_MAPPING_PATH,
  KOINE_REGISTRY_REL,
  KOINE_CORE_TSV_REL,
  KOINE_SOURCE_RELS,
  DEFAULT_KOINE_ROOT,
} from "./regen-registry-mirror.ts";

/** Resolve + presence-gate the koine checkout exactly like the source + the byte test. */
const KOINE_ROOT = resolveKoineRoot();
const hasKoine = existsSync(join(KOINE_ROOT, KOINE_REGISTRY_REL));

describe("regen-registry-mirror — TSV parsing", () => {
  it("parses a core relations row into the exact RelationSignature shape (unqualified name)", () => {
    const tsv = [
      "relation\tarity\targ_roles\tsymmetric\ttier\tdomain\tinverse\tdescription",
      "same_as\t2\ta|b\ttrue\tgrounding-only\tcore\t\tIdentical referents",
      "caused_by\t2\teffect|cause\tfalse\thorn-safe\tcore\tcauses\tEvent causality",
    ].join("\n");
    const entries = parseRelationsTsv(tsv, { core: true });
    expect(entries).toEqual([
      { name: "same_as", signature: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" } },
      { name: "caused_by", signature: { arity: 2, argRoles: ["effect", "cause"], symmetric: false, tier: "horn-safe" } },
    ]);
  });

  it("prefixes a domain row from the TSV `domain` column, not the file stem", () => {
    // The relation column is already qualified; the prefix is re-derived from the domain
    // column, so `relations/cinematography.tsv` (domain=cine) keys on `cine:`, never `cinematography:`.
    const tsv = [
      "relation\tarity\targ_roles\tsymmetric\ttier\tdomain\tinverse\tdescription",
      "cine:shows\t2\tshot|subject\tfalse\tgrounding-only\tcine\t\tA shot depicts a subject",
    ].join("\n");
    const [entry] = parseRelationsTsv(tsv, { core: false });
    expect(entry.name).toBe("cine:shows");
    expect(entry.signature).toEqual({ arity: 2, argRoles: ["shot", "subject"], symmetric: false, tier: "grounding-only" });
  });

  it("fails loudly on a malformed row (bad arity / symmetric / tier / missing column)", () => {
    const header = "relation\tarity\targ_roles\tsymmetric\ttier\tdomain\tinverse\tdescription";
    expect(() => parseRelationsTsv(`${header}\nr\tx\ta|b\ttrue\tgrounding-only\tcore\t\td`, { core: true })).toThrow(/arity/i);
    expect(() => parseRelationsTsv(`${header}\nr\t2\ta|b\tmaybe\tgrounding-only\tcore\t\td`, { core: true })).toThrow(/symmetric/i);
    expect(() => parseRelationsTsv(`${header}\nr\t2\ta|b\ttrue\tdatalog-ish\tcore\t\td`, { core: true })).toThrow(/tier/i);
    expect(() => parseRelationsTsv("relation\tarity\n r\t2", { core: true })).toThrow(/column/i);
  });
});

describe("regen-registry-mirror — kgp.ts block rendering", () => {
  it("renders an entry line byte-for-byte in the hand-authored style", () => {
    expect(renderEntries([
      { name: "same_as", signature: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" } },
      { name: "cine:shows", signature: { arity: 2, argRoles: ["shot", "subject"], symmetric: false, tier: "grounding-only" } },
    ])).toBe(
      '  same_as: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" },\n' +
        '  "cine:shows": { arity: 2, argRoles: ["shot", "subject"], symmetric: false, tier: "grounding-only" },',
    );
  });

  it("is idempotent — regenerating a source twice is a fixed point", () => {
    const source = readFileSync(KGP_PATH, "utf8");
    const core = [{ name: "same_as", signature: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "grounding-only" } }];
    const domain = [{ name: "soc:spouse_of", signature: { arity: 2, argRoles: ["a", "b"], symmetric: true, tier: "horn-safe" } }];
    const once = regenerateKgpSource(source, core, domain);
    expect(regenerateKgpSource(once, core, domain)).toBe(once);
  });

  it("throws when a generated marker is missing (never silently no-ops)", () => {
    expect(() => regenerateKgpSource("no markers here", [], [])).toThrow(/marker/i);
  });
});

describe("regen-registry-mirror — fail-fast, never one-sided", () => {
  it("names the missing path and KOINE_ROOT when a source file is absent", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "koine-missing-"));
    try {
      const err = (() => {
        try {
          readKoineSource(emptyRoot, KOINE_REGISTRY_REL);
          return null;
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err).not.toBeNull();
      expect(err?.message).toContain(join(emptyRoot, KOINE_REGISTRY_REL));
      expect(err?.message).toContain("KOINE_ROOT");
      expect(err?.message).toMatch(/one-sided|nothing was written/i);
    } finally {
      // temp dir is auto-reclaimed by the OS; nothing to clean here.
    }
  });

  it("aborts buildRegen without writing either mirror when a source is missing", () => {
    const partialRoot = mkdtempSync(join(tmpdir(), "koine-partial-"));
    // Only the JSON is present; the four TSVs are absent — regen must not write a one-sided mirror.
    mkdirSync(join(partialRoot, "registry"), { recursive: true });
    writeFileSync(join(partialRoot, KOINE_REGISTRY_REL), "{}\n");

    const jsonBefore = readFileSync(PREDICATE_MAPPING_PATH, "utf8");
    const kgpBefore = readFileSync(KGP_PATH, "utf8");
    expect(() => buildRegen(partialRoot)).toThrow(/relations\.tsv/);
    expect(() => writeRegen(partialRoot)).toThrow();
    // Neither mirror was touched.
    expect(readFileSync(PREDICATE_MAPPING_PATH, "utf8")).toBe(jsonBefore);
    expect(readFileSync(KGP_PATH, "utf8")).toBe(kgpBefore);
  });
});

describe("regen-registry-mirror — live koine round-trip", () => {
  it("resolves the same KOINE_ROOT the byte-identical drift test uses", () => {
    expect(resolveKoineRoot()).toBe(process.env.KOINE_ROOT ?? join(homedir(), "Development", "koine"));
    expect(DEFAULT_KOINE_ROOT).toBe(join(homedir(), "Development", "koine"));
    expect(KOINE_SOURCE_RELS).toHaveLength(5);
  });

  // The core property: running the regen against the already-vendored 0.4.2 koine checkout
  // produces an empty diff — both mirrors are byte-identical to what regen would write.
  it.skipIf(!hasKoine)("regenerates both mirrors byte-identically to the vendored copies (empty diff)", () => {
    const { predicateMappingJson, kgpSource } = buildRegen();
    expect(predicateMappingJson).toBe(readFileSync(PREDICATE_MAPPING_PATH, "utf8"));
    expect(kgpSource).toBe(readFileSync(KGP_PATH, "utf8"));
  });

  // Determinism/idempotency proven against a copy of the koine checkout, independent of
  // where the sibling repo lives: writing twice leaves the second write a no-op.
  it.skipIf(!hasKoine)("is deterministic — a second regen against an unchanged checkout is a no-op", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "koine-copy-"));
    cpSync(join(KOINE_ROOT, "registry"), join(fixtureRoot, "registry"), { recursive: true });
    const first = buildRegen(fixtureRoot);
    const second = buildRegen(fixtureRoot);
    expect(second).toEqual(first);
  });

  // The read-only `check:registry-mirror` CLI is clean (exit 0) against the vendored 0.4.2
  // mirror — it writes nothing and only reports staleness (US-4).
  it.skipIf(!hasKoine)("check:registry-mirror reports clean (exit 0) on the freshly vendored mirror", () => {
    const jsonBefore = readFileSync(PREDICATE_MAPPING_PATH, "utf8");
    const kgpBefore = readFileSync(KGP_PATH, "utf8");
    expect(runCheck()).toBe(0);
    // Read-only: neither mirror was touched by the check.
    expect(readFileSync(PREDICATE_MAPPING_PATH, "utf8")).toBe(jsonBefore);
    expect(readFileSync(KGP_PATH, "utf8")).toBe(kgpBefore);
  });

  it("leaves the predicate-mapping registry valid, with every koineRelation resolvable", () => {
    // AC3: after a regen `assertValidPredicateMapping()` does not throw and
    // `relationSignature()` resolves for every koineRelations entry in the registry.
    expect(() => assertValidPredicateMapping()).not.toThrow();
    const koineRelations = new Set<string>();
    for (const project of Object.keys(PREDICATE_MAPPING.projects)) {
      for (const rel of relationsForProject(project)) {
        for (const kr of rel.koineRelations) koineRelations.add(kr);
      }
    }
    expect(koineRelations.size).toBeGreaterThan(0);
    for (const kr of ["soc:parent_of", "cine:shows", "caused_by"]) expect(koineRelations.has(kr)).toBe(true);
    for (const kr of koineRelations) expect(relationSignature(kr), kr).toBeDefined();
  });
});
