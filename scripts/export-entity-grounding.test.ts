import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEntityGrounding,
  buildFixtureSnapshot,
  snapshotEnvelope,
  snapshotJson,
  parseAliases,
  parseArgs,
  licenseClass,
  licenseAllowed,
  writeSnapshot,
  CONTRACT_VERSION,
  DEFAULT_LICENSE_CLASSES,
  FIXTURE_GENERATED_AT,
  FIXTURE_SNAPSHOT_PATH,
  type GroundingEntity,
} from "./export-entity-grounding";

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

describe("export-entity-grounding (analyzer-bridge US-002)", () => {
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
        // Snapshots are byte-identical modulo the envelope timestamp.
        const wrap = (es: GroundingEntity[]) =>
          snapshotJson(snapshotEnvelope(es, { generatedAt: "T" }));
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
        const snap = snapshotEnvelope([], { generatedAt: "T" });
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
  });
});
