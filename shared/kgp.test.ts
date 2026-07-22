import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  ALL_LICENSE_CLASSES,
  DEFAULT_LICENSE_POLICY_CLASSES,
  KGP_CORE_RELATIONS,
  KGP_DOMAIN_RELATIONS,
  KGP_RELATION_DOMAINS,
  KGP_VERSION,
  PACK_WORLD,
  RESERVED_LINK_RELATIONS,
  assertRelationAllowed,
  canonicalArg,
  canonicalClaimArgs,
  canonicalCurie,
  canonicalJson,
  claimHashInput,
  csidToKinpCurie,
  curieToIri,
  isLinkRelation,
  kinpLocal,
  licensePolicyClass,
  licensePolicyFor,
  mintClaimId,
  mintPackId,
  packHashInput,
  relationSignature,
  wikidataEntityCurie,
} from "./kgp";

const sha256 = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

/** The three dialect (portability) tiers a registry row may declare (§5). */
const ALL_DIALECTS = ["grounding-only", "horn-safe", "full-prolog"];

describe("kgp (koine/specs/grounding-pack.md)", () => {
  describe("relation registry", () => {
    it("vendors the core vocabulary with immutable signatures", () => {
      expect(KGP_VERSION).toBe("0.4.0");
      expect(relationSignature("exact_match")).toEqual({
        arity: 2,
        argRoles: ["a", "b"],
        symmetric: true,
        tier: "grounding-only",
      });
      // Every vendored row carries a full signature.
      for (const [name, sig] of Object.entries(KGP_CORE_RELATIONS)) {
        expect(sig.arity, name).toBe(sig.argRoles.length);
        expect(ALL_DIALECTS, name).toContain(sig.tier);
      }
    });

    it("keeps a horn-safe relation out of a grounding-only pack (§5)", () => {
      expect(() => assertRelationAllowed("exact_match", "grounding-only")).not.toThrow();
      expect(() => assertRelationAllowed("part_of", "grounding-only")).toThrow(/horn-safe/);
      expect(() => assertRelationAllowed("part_of", "horn-safe")).not.toThrow();
      expect(() => assertRelationAllowed("shows", "grounding-only")).toThrow(/relation registry/);
    });

    it("vendors the domain extensions pinakes speaks (cine / media / soc)", () => {
      expect(KGP_RELATION_DOMAINS).toEqual(["cine", "media", "soc"]);
      // A domain prefix is the TSV's `domain` column, NOT its file stem
      // (relations/cinematography.tsv declares `cine:`).
      for (const [name, sig] of Object.entries(KGP_DOMAIN_RELATIONS)) {
        expect(name, name).toMatch(/^[a-z]+:[a-z_]+$/);
        expect(KGP_RELATION_DOMAINS, name).toContain(name.slice(0, name.indexOf(":")));
        expect(sig.arity, name).toBe(sig.argRoles.length);
        expect(ALL_DIALECTS, name).toContain(sig.tier);
      }
      // The Insimul bridge's social vocabulary: spouse_of is symmetric (operands sorted
      // before hashing, §3.2 rule 2) and horn-safe, so it needs a horn-safe pack.
      expect(relationSignature("soc:spouse_of")).toEqual({
        arity: 2,
        argRoles: ["a", "b"],
        symmetric: true,
        tier: "horn-safe",
      });
      expect(() => assertRelationAllowed("soc:spouse_of", "grounding-only")).toThrow(/horn-safe/);
      expect(() => assertRelationAllowed("soc:spouse_of", "horn-safe")).not.toThrow();
      // A domain pinakes does not speak is not in the vocabulary.
      expect(relationSignature("mystery:spouse_of")).toBeUndefined();
    });

    it("separates KINP's reserved link relations from ordinary assertions (§2)", () => {
      expect(isLinkRelation("same_as")).toBe(true);
      expect(isLinkRelation("retracts")).toBe(true);
      // exact_match anchors to an external authority; it is not a reserved KINP relation.
      expect(isLinkRelation("exact_match")).toBe(false);
      for (const relation of RESERVED_LINK_RELATIONS) {
        expect(relationSignature(relation), relation).toBeDefined();
      }
    });
  });

  describe("KINP identifier forms (identity.md §3; canonical-schema.md §3.1)", () => {
    it("derives the entity CURIE and IRI from a csid", () => {
      expect(csidToKinpCurie("cs:language:Q1860")).toBe("pinakes:ent:language.q1860");
      expect(curieToIri("pinakes:ent:language.q1860")).toBe(
        "https://id.koine.example/ent/pinakes/language.q1860",
      );
      expect(csidToKinpCurie("cs:culture:proto-indo-european")).toBe(
        "pinakes:ent:culture.proto-indo-european",
      );
      expect(() => csidToKinpCurie("language:Q1860")).toThrow(/not a csid/);
    });

    it("percent-encodes everything outside the KINP local-id grammar", () => {
      // The `:` an alias-anchored local can itself contain, and non-ASCII names.
      expect(kinpLocal("alias:Wikidata")).toBe("alias%3awikidata");
      expect(kinpLocal("café")).toBe("caf%c3%a9");
      expect(csidToKinpCurie("cs:place:alias:paris")).toBe("pinakes:ent:place.alias%3aparis");
    });

    it("lowercases only the namespace and kind of a CURIE (§3.2 rule 3)", () => {
      // An external authority's local id is its own — a QID keeps its case.
      expect(wikidataEntityCurie("Q150")).toBe("wikidata:ent:Q150");
      expect(canonicalCurie("Wikidata:ENT:Q150")).toBe("wikidata:ent:Q150");
      expect(canonicalCurie("insimul:world:alderforest:ent:npc-renaud")).toBe(
        "insimul:world:alderforest:ent:npc-renaud",
      );
      expect(() => canonicalCurie("nope")).toThrow(/not a CURIE/);
    });
  });

  describe("§3 claim normalization (NORMATIVE)", () => {
    it("builds the world|relation(args) hash input with no insignificant whitespace", () => {
      expect(
        claimHashInput({
          world: PACK_WORLD,
          relation: "exact_match",
          args: [
            { kind: "id", curie: "pinakes:ent:language.q150" },
            { kind: "id", curie: "wikidata:ent:Q150" },
          ],
        }),
      ).toBe(
        "pinakes:world:consensus-reality|exact_match(pinakes:ent:language.q150,wikidata:ent:Q150)",
      );
    });

    it("sorts the operands of a symmetric relation so argument order cannot fork an id (§3.2 rule 2)", () => {
      const args = (a: string, b: string) =>
        canonicalClaimArgs({
          world: PACK_WORLD,
          relation: "same_as",
          args: [
            { kind: "id", curie: a },
            { kind: "id", curie: b },
          ],
        });
      expect(args("wikidata:ent:Q150", "pinakes:ent:language.q150")).toEqual([
        "pinakes:ent:language.q150",
        "wikidata:ent:Q150",
      ]);
      expect(args("wikidata:ent:Q150", "pinakes:ent:language.q150")).toEqual(
        args("pinakes:ent:language.q150", "wikidata:ent:Q150"),
      );
      // An asymmetric relation keeps the registry's semantic order.
      expect(
        canonicalClaimArgs({
          world: PACK_WORLD,
          relation: "based_on",
          args: [
            { kind: "id", curie: "b:ent:x" },
            { kind: "id", curie: "a:ent:y" },
          ],
        }),
      ).toEqual(["b:ent:x", "a:ent:y"]);
    });

    it("rejects an unregistered relation or the wrong arity", () => {
      const claim = { world: PACK_WORLD, relation: "same_as", args: [{ kind: "id" as const, curie: "a:ent:x" }] };
      expect(() => claimHashInput(claim)).toThrow(/arity 2/);
      expect(() =>
        claimHashInput({ ...claim, relation: "invented_relation", args: [] }),
      ).toThrow(/relation registry/);
    });

    it("canonicalizes literals per §3.2 rule 5", () => {
      expect(canonicalArg({ kind: "string", value: 'a "quoted" \\ path' })).toBe(
        '"a \\"quoted\\" \\\\ path"',
      );
      expect(canonicalArg({ kind: "integer", value: -0 })).toBe("0");
      expect(canonicalArg({ kind: "integer", value: 42 })).toBe("42");
      expect(() => canonicalArg({ kind: "integer", value: 1.5 })).toThrow(/safe integer/);
      expect(canonicalArg({ kind: "decimal", value: 0.5 })).toBe("0.5");
      expect(canonicalArg({ kind: "decimal", value: 0 })).toBe("0");
      // No exponent inside the |exp| < 16 band, lowercase `e` outside it.
      expect(canonicalArg({ kind: "decimal", value: 1e-7 })).toBe("0.0000001");
      expect(canonicalArg({ kind: "decimal", value: 1e21 })).toBe("1e21");
      expect(canonicalArg({ kind: "boolean", value: true })).toBe("true");
      expect(canonicalArg({ kind: "datetime", value: "2026-01-01T00:00:00Z" })).toBe(
        "2026-01-01T00:00:00.000Z",
      );
      expect(() => canonicalArg({ kind: "datetime", value: "not a date" })).toThrow(/ISO-8601/);
    });

    it("mints `sha256-<lowerhex>` claim ids that merge across producers (§3.1)", () => {
      const claim = {
        world: PACK_WORLD,
        relation: "exact_match" as const,
        args: [
          { kind: "id" as const, curie: "pinakes:ent:language.q150" },
          { kind: "id" as const, curie: "wikidata:ent:Q150" },
        ],
      };
      const id = mintClaimId(claim, sha256);
      expect(id).toBe(`sha256-${sha256(claimHashInput(claim))}`);
      expect(id).toMatch(/^sha256-[0-9a-f]{64}$/);
      // Operand order and NFC-equal spellings are the same claim.
      const flipped = mintClaimId({ ...claim, args: [claim.args[1], claim.args[0]] }, sha256);
      expect(flipped).toBe(id);
    });
  });

  describe("§2.1 pack identity", () => {
    it("canonicalizes JSON with sorted keys and no whitespace", () => {
      expect(canonicalJson({ b: 1, a: [3, { d: 4, c: null }] })).toBe(
        '{"a":[3,{"c":null,"d":4}],"b":1}',
      );
      expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
    });

    it("hashes manifest ⊕ id-sorted contents, so element order cannot change the address", () => {
      const parts = {
        manifest: { kind: "snapshot", counts: { entities: 2 } },
        entities: [
          { id: "cs:b", record: { csid: "cs:b" } },
          { id: "cs:a", record: { csid: "cs:a" } },
        ],
        assertions: [],
        links: [],
      };
      const shuffled = { ...parts, entities: [...parts.entities].reverse() };
      expect(packHashInput(shuffled)).toBe(packHashInput(parts));
      expect(mintPackId(parts, sha256)).toBe(`sha256-${sha256(packHashInput(parts))}`);
      // Different content ⇒ different address.
      expect(
        mintPackId({ ...parts, entities: parts.entities.slice(0, 1) }, sha256),
      ).not.toBe(mintPackId(parts, sha256));
    });
  });

  describe("§7.1 license-class policy", () => {
    it("classifies SPDX ids and families, stricter constraint winning", () => {
      expect(licensePolicyClass("CC0-1.0")).toBe("public-domain");
      expect(licensePolicyClass("CC0")).toBe("public-domain");
      expect(licensePolicyClass("CC-BY-4.0")).toBe("attribution");
      expect(licensePolicyClass("CC-BY-SA-3.0")).toBe("share-alike");
      expect(licensePolicyClass("CC-BY-NC-SA-4.0")).toBe("non-commercial");
      expect(licensePolicyClass("MIT")).toBe("permissive");
      expect(licensePolicyClass("")).toBe("proprietary");
      expect(licensePolicyClass("All-Rights-Reserved")).toBe("proprietary");
    });

    it("maps pinakes's SPDX filter onto the spec's allowlist", () => {
      expect(licensePolicyFor(["CC0", "CC-BY"])).toEqual({
        allowed_classes: ["public-domain", "attribution"],
        allowed_spdx_classes: ["CC0", "CC-BY"],
        on_violation: "reject-with-report",
      });
      // Classes come back in admission order, never the caller's order.
      expect(licensePolicyFor(["CC-BY-SA", "CC0"]).allowed_classes).toEqual([
        "public-domain",
        "share-alike",
      ]);
      for (const cls of DEFAULT_LICENSE_POLICY_CLASSES) {
        expect(ALL_LICENSE_CLASSES).toContain(cls);
      }
    });
  });
});
