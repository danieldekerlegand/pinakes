import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildAssertions,
  buildEntityGrounding,
  buildFixtureSnapshot,
  buildGroundingPack,
  snapshotJson,
  packFileName,
  parseAliases,
  parseArgs,
  licenseClass,
  licenseAllowed,
  writeSnapshot,
  ANCHOR_RELATION,
  CONTRACT_VERSION,
  DEFAULT_LICENSE_CLASSES,
  FIXTURE_GENERATED_AT,
  FIXTURE_SNAPSHOT_PATH,
  type GroundingEntity,
} from "./export-entity-grounding";
import {
  KGP_VERSION,
  PACK_WORLD,
  claimHashInput,
  csidToKinpCurie,
  wikidataEntityCurie,
} from "@contracts/kgp";

/** Write a `{ file: rows[][] }` map of TSVs into a fresh temp lexicons dir. */
function makeFixtureDir(files: Record<string, string[][]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-grounding-"));
  for (const [file, rows] of Object.entries(files)) {
    const content = rows.map((r) => r.join("\t")).join("\n") + "\n";
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

const byCsid = (es: readonly GroundingEntity[], csid: string) =>
  es.find((e) => e.csid === csid);

describe("export-entity-grounding", () => {
  describe("license classes", () => {
    it("strips the version to the license family", () => {
      expect(licenseClass("CC0-1.0")).toBe("CC0");
      expect(licenseClass("CC-BY-4.0")).toBe("CC-BY");
      expect(licenseClass("CC-BY-SA-3.0")).toBe("CC-BY-SA");
      expect(licenseClass("CC-BY-NC-4.0")).toBe("CC-BY-NC");
      // Non-versioned ids are their own class.
      expect(licenseClass("MIT")).toBe("MIT");
    });

    it("allows only members of the class list (default excludes share-alike)", () => {
      expect(licenseAllowed("CC-BY-4.0", DEFAULT_LICENSE_CLASSES)).toBe(true);
      expect(licenseAllowed("CC0-1.0", DEFAULT_LICENSE_CLASSES)).toBe(true);
      expect(licenseAllowed("CC-BY-SA-4.0", DEFAULT_LICENSE_CLASSES)).toBe(false);
    });
  });

  describe("parseAliases", () => {
    it("parses JSON arrays, delimited lists, and single values; dedupes", () => {
      expect(parseAliases('["Deutsch","Alemán"]')).toEqual(["Deutsch", "Alemán"]);
      expect(parseAliases("Deutsch; Alemán")).toEqual(["Deutsch", "Alemán"]);
      expect(parseAliases("français")).toEqual(["français"]);
      expect(parseAliases("")).toEqual([]);
      expect(parseAliases("a; a; b")).toEqual(["a", "b"]);
      // Commas are NOT split — names contain them.
      expect(parseAliases("Congo, Democratic Republic")).toEqual([
        "Congo, Democratic Republic",
      ]);
    });
  });

  describe("key emission per entity type", () => {
    it("emits iso/glottocode keys for languages and only name+type for others", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "native_name", "iso639_1", "iso639_2", "glottocode", "wikidata_qid"],
          ["fr", "French", "français", "fr", "fra", "stan1290", "Q150"],
        ],
        "cuisines.tsv": [
          ["id", "name", "region"],
          ["thai", "Thai", "Southeast Asia"],
        ],
      });
      try {
        const es = buildEntityGrounding(dir);
        const french = byCsid(es, "cs:language:Q150")!;
        expect(french.entityType).toBe("language");
        expect(french.reconciliation).toEqual({
          wikidataQid: "Q150",
          normalizedName: "french",
          iso639_1: "fr",
          iso639_2: "fra",
          glottocode: "stan1290",
        });
        expect(french.aliases).toEqual(["français"]);

        const thai = byCsid(es, "cs:cuisine:thai")!;
        expect(thai.entityType).toBe("cuisine");
        // No language codes for a non-language entity.
        expect(thai.reconciliation).toEqual({
          wikidataQid: "",
          normalizedName: "thai",
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("stays size-conscious — no description/bulk fields leak into a record", () => {
      const dir = makeFixtureDir({
        "civilizations.tsv": [
          ["id", "name", "description", "wikidata_qid"],
          ["sumer", "Sumer", "A long bulk description that must not appear.", "Q35355"],
        ],
      });
      try {
        const [entity] = buildEntityGrounding(dir);
        expect(Object.keys(entity).sort()).toEqual([
          "aliases",
          "csid",
          "entityType",
          "license",
          "name",
          "provenance",
          "reconciliation",
        ]);
        expect(JSON.stringify(entity)).not.toContain("bulk description");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("license exclusion", () => {
    it("excludes entities whose license class is not allowed (row-level license wins)", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "iso639_1", "license"],
          ["byrow", "ByLang", "a", ""], // no row license → default CC-BY-4.0 → included
          ["cc0", "ZeroLang", "b", "CC0-1.0"], // included
          ["sa", "ShareLang", "c", "CC-BY-SA-4.0"], // excluded by default classes
        ],
      });
      try {
        const def = buildEntityGrounding(dir);
        expect(def.map((e) => e.csid).sort()).toEqual([
          "cs:language:byrow",
          "cs:language:cc0",
        ]);
        expect(byCsid(def, "cs:language:byrow")!.license).toBe("CC-BY-4.0");

        // Widening the class list lets the share-alike row through.
        const wide = buildEntityGrounding(dir, {
          licenseClasses: ["CC0", "CC-BY", "CC-BY-SA"],
        });
        expect(wide.map((e) => e.csid)).toContain("cs:language:sa");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("domain filtering", () => {
    it("keeps only the requested entity-type domains", () => {
      const dir = makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "iso639_1"],
          ["fr", "French", "fr"],
        ],
        "cuisines.tsv": [
          ["id", "name"],
          ["thai", "Thai"],
        ],
      });
      try {
        const langOnly = buildEntityGrounding(dir, { domains: ["language"] });
        expect(langOnly.map((e) => e.entityType)).toEqual(["language"]);

        const both = buildEntityGrounding(dir);
        expect(both.map((e) => e.entityType).sort()).toEqual(["cuisine", "language"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("determinism", () => {
    it("dedupes by csid, csid-sorts, and re-runs byte-identically", () => {
      const dir = makeFixtureDir({
        "cuisines.tsv": [
          ["id", "name"],
          ["z", "Zeta"],
          ["a", "Alpha"],
          ["a", "Alpha dup"], // dropped by csid dedup
        ],
      });
      try {
        const a = buildEntityGrounding(dir);
        const b = buildEntityGrounding(dir);
        expect(a.map((e) => e.csid)).toEqual(["cs:cuisine:a", "cs:cuisine:z"]);
        // Packs are byte-identical modulo the envelope timestamp.
        const wrap = (es: GroundingEntity[]) =>
          snapshotJson(buildGroundingPack(es, { generatedAt: "T" }));
        expect(wrap(a)).toEqual(wrap(b));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("CLI arg parsing", () => {
    it("parses license classes, domains, and out dir", () => {
      expect(
        parseArgs(["--license-classes", "CC0,CC-BY-SA", "--domains", "language, place"]),
      ).toMatchObject({
        licenseClasses: ["CC0", "CC-BY-SA"],
        domains: ["language", "place"],
      });
      expect(parseArgs(["--emit-fixture"]).emitFixture).toBe(true);
      expect(parseArgs([]).licenseClasses).toEqual([...DEFAULT_LICENSE_CLASSES]);
    });
  });

  describe("writer", () => {
    it("writes snapshot.json under the out dir", () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-grounding-out-"));
      try {
        const snap = buildGroundingPack([], { generatedAt: "T" });
        writeSnapshot(snap, outDir);
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(outDir, "snapshot.json"), "utf8"),
        );
        expect(onDisk.contractVersion).toBe(CONTRACT_VERSION);
        expect(onDisk.count).toBe(0);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });

  describe("KGP envelope (US-PKA3)", () => {
    const twoEntities = () =>
      makeFixtureDir({
        "languages.tsv": [
          ["id", "name", "iso639_1", "wikidata_qid", "source_url", "retrieved_at", "confidence"],
          ["fr", "French", "fr", "Q150", "https://www.wikidata.org/entity/Q150", "2026-01-01", "0.9"],
          ["nq", "NoQid", "nq", "", "", "", ""],
        ],
      });

    it("carries the KGP §2 envelope around the unchanged entity payload", () => {
      const dir = twoEntities();
      try {
        const pack = buildGroundingPack(buildEntityGrounding(dir), { generatedAt: "T" });
        expect(pack.kgp_version).toBe(KGP_VERSION);
        expect(pack.producer).toBe("pinakes");
        expect(pack.worlds).toEqual([PACK_WORLD]);
        expect(pack.kind).toBe("snapshot");
        expect(pack.basis).toBeNull();
        expect(pack.dialect).toBe("grounding-only");
        expect(pack.pack_id).toMatch(/^sha256-[0-9a-f]{64}$/);
        // The pinakes envelope a Bridge-1 consumer pins is still there.
        expect(pack.contractVersion).toBe(CONTRACT_VERSION);
        expect(pack.source).toBe("pinakes");
        expect(pack.count).toBe(pack.entities.length);
        expect(pack.entities.map((e) => e.csid)).toEqual(["cs:language:Q150", "cs:language:nq"]);
        // Manifest: counts + emission metadata + the §7.1 policy.
        expect(pack.manifest.counts).toEqual({ entities: 2, assertions: 1, links: 0 });
        expect(pack.manifest.created).toBe("T");
        expect(pack.manifest.signing).toEqual({ key_id: null, alg: "ed25519" });
        expect(pack.links).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("mints assertion ids by the normative KGP §3 normalization", () => {
      const dir = twoEntities();
      try {
        const entities = buildEntityGrounding(dir);
        const [anchor, ...rest] = buildAssertions(entities);
        // Only the QID-bearing entity yields an anchor.
        expect(rest).toEqual([]);
        expect(anchor.relation).toBe(ANCHOR_RELATION);
        expect(anchor.world).toBe(PACK_WORLD);
        expect(anchor.subject).toBe(csidToKinpCurie("cs:language:Q150"));
        expect(anchor.subject).toBe("pinakes:ent:language.q150");
        expect(anchor.object).toBe(wikidataEntityCurie("Q150"));

        // The id is the sha256 of the §3.1 hash input — recomputed here independently.
        const expected = crypto
          .createHash("sha256")
          .update(
            claimHashInput({
              world: PACK_WORLD,
              relation: ANCHOR_RELATION,
              args: [
                { kind: "id", curie: "pinakes:ent:language.q150" },
                { kind: "id", curie: "wikidata:ent:Q150" },
              ],
            }),
            "utf8",
          )
          .digest("hex");
        expect(anchor.id).toBe(`sha256-${expected}`);

        // Confidence/licence/provenance ride on the record, never in the claim id.
        expect(anchor.confidence).toBe(0.9);
        expect(anchor.license).toBe("CC-BY-4.0");
        expect(anchor.prov).toEqual({
          agent: "pinakes:agent:resolver",
          activity: "pinakes:src:export-entity-grounding",
          asserted: "2026-01-01",
          method: "wikidata-qid-anchor",
          source_url: "https://www.wikidata.org/entity/Q150",
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("republishes the SPDX filter as the KGP §7.1 license policy", () => {
      const pack = buildGroundingPack([], { generatedAt: "T" });
      expect(pack.manifest.license_policy).toEqual({
        allowed_classes: ["public-domain", "attribution"],
        allowed_spdx_classes: ["CC0", "CC-BY"],
        on_violation: "reject-with-report",
      });
      const wide = buildGroundingPack([], {
        generatedAt: "T",
        licenseClasses: ["CC0", "CC-BY", "CC-BY-SA"],
      });
      expect(wide.manifest.license_policy.allowed_classes).toEqual([
        "public-domain",
        "attribution",
        "share-alike",
      ]);
    });

    it("is content-addressed: same input ⇒ same pack_id, regardless of when it was built", () => {
      const dir = twoEntities();
      try {
        const entities = buildEntityGrounding(dir);
        const first = buildGroundingPack(entities, { generatedAt: "2026-01-01T00:00:00.000Z" });
        const later = buildGroundingPack(entities, { generatedAt: "2027-06-30T12:34:56.000Z" });
        expect(later.pack_id).toBe(first.pack_id);

        // Different knowledge ⇒ different address (entity set, and the applied filter).
        const fewer = buildGroundingPack(entities.slice(0, 1), { generatedAt: "T" });
        expect(fewer.pack_id).not.toBe(first.pack_id);
        const widened = buildGroundingPack(entities, {
          generatedAt: "T",
          licenseClasses: ["CC0", "CC-BY", "CC-BY-SA"],
        });
        expect(widened.pack_id).not.toBe(first.pack_id);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("keeps snapshot and delta kinds honest about their basis (KGP §6)", () => {
      expect(() =>
        buildGroundingPack([], { generatedAt: "T", kind: "delta" }),
      ).toThrow(/basis/);
      expect(() =>
        buildGroundingPack([], { generatedAt: "T", basis: "sha256-abc" }),
      ).toThrow(/snapshot/);
      const delta = buildGroundingPack([], {
        generatedAt: "T",
        kind: "delta",
        basis: "sha256-abc",
      });
      expect(delta.kind).toBe("delta");
      expect(delta.basis).toBe("sha256-abc");
      expect(packFileName("delta")).toBe("delta.json");
      expect(packFileName("snapshot")).toBe("snapshot.json");
    });
  });

  describe("committed fixture snapshot", () => {
    it("is in sync with a fresh build of the fixture lexicons", () => {
      const onDisk = fs.readFileSync(FIXTURE_SNAPSHOT_PATH, "utf8");
      expect(snapshotJson(buildFixtureSnapshot())).toEqual(onDisk);
    });

    it("pins the generatedAt timestamp so it is deterministic", () => {
      const snap = buildFixtureSnapshot();
      expect(snap.generatedAt).toBe(FIXTURE_GENERATED_AT);
      // The share-alike fixture row is excluded by the default license classes.
      expect(snap.entities.map((e) => e.csid)).not.toContain("cs:language:share");
    });
  });

  describe("live corpus", () => {
    it("builds a non-empty, default-license-clean snapshot", () => {
      const es = buildEntityGrounding();
      expect(es.length).toBeGreaterThan(0);
      // Every emitted entity respects the default license classes and is csid-sorted.
      for (const e of es) {
        expect(licenseAllowed(e.license, DEFAULT_LICENSE_CLASSES)).toBe(true);
      }
      const csids = es.map((e) => e.csid);
      expect([...csids].sort()).toEqual(csids);
      // csid uniqueness (deduped).
      expect(new Set(csids).size).toBe(csids.length);
    });

    it("packs the corpus reproducibly, one anchor per QID-bearing entity", () => {
      const es = buildEntityGrounding();
      const pack = buildGroundingPack(es, { generatedAt: "2026-01-01T00:00:00.000Z" });
      const anchored = es.filter((e) => e.reconciliation.wikidataQid !== "").length;
      expect(anchored).toBeGreaterThan(0);
      expect(pack.assertions).toHaveLength(anchored);
      const ids = pack.assertions.map((a) => a.id);
      expect([...ids].sort()).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
      // Rebuilding the same corpus lands on the same content address.
      expect(buildGroundingPack(es, { generatedAt: "later" }).pack_id).toBe(pack.pack_id);
    });
  });
});
