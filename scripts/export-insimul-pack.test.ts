import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { homedir } from "node:os";
import {
  assertMatchesInsimulSchema,
  assertSeedMappingsRegistered,
  buildFixturePack,
  buildInsimulPack,
  buildPrologFacts,
  buildSeedIndex,
  loadInsimulSchema,
  packJson,
  parseArgs,
  prologAtom,
  registryEntryFor,
  seedRefKey,
  seedMappingFor,
  validateJsonSchema,
  writeInsimulPack,
  FIXTURE_PACK_PATH,
  INSIMUL_CONTRACT_VERSION,
  INSIMUL_SCHEMA_PATH,
  INSIMUL_SCHEMA_REPO_PATH,
  INSIMUL_SOURCE,
  SEED_MAPPINGS,
  type InsimulGroundingPack,
  type SeedMapping,
} from "./export-insimul-pack";
import {
  assertLicenseColumn,
  buildEntityGrounding,
  DEFAULT_LICENSE_CLASSES,
  FIXTURE_GENERATED_AT,
} from "./export-entity-grounding";
import { PREDICATE_MAPPING, externalPredicates } from "@shared/predicate-mapping";

/** Insimul's shipped contract artifacts (`INSIMUL_ROOT` overrides — same as the registry test). */
const INSIMUL_ROOT =
  process.env.INSIMUL_ROOT ?? path.join(homedir(), "Development", "workspace", "insimul-babylon");
const INSIMUL_SCHEMA = path.join(INSIMUL_ROOT, INSIMUL_SCHEMA_REPO_PATH);
const hasInsimulSchema = fs.existsSync(INSIMUL_SCHEMA);

const INSIMUL_PREDICATE_SCHEMA = path.join(
  INSIMUL_ROOT,
  "packages",
  "core",
  "src",
  "prolog",
  "predicate-schema.ts",
);
const hasInsimulCatalog = fs.existsSync(INSIMUL_PREDICATE_SCHEMA);

/** Write a `{ file: rows[][] }` map of TSVs into a fresh temp lexicons dir. */
function makeFixtureDir(files: Record<string, string[][]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-insimul-"));
  for (const [file, rows] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), rows.map((r) => r.join("\t")).join("\n") + "\n");
  }
  return dir;
}

/** Build a pack over a throwaway lexicons dir, cleaning up afterwards. */
function withCorpus<T>(
  files: Record<string, string[][]>,
  fn: (build: (opts?: { licenseClasses?: string[]; domains?: string[] }) => InsimulGroundingPack, dir: string) => T,
): T {
  const dir = makeFixtureDir(files);
  try {
    return fn(
      (opts = {}) =>
        buildInsimulPack({
          lexiconsDir: dir,
          generatedAt: "T",
          licenseClasses: opts.licenseClasses,
          domains: opts.domains,
        }),
      dir,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SUMER = [
  ["id", "name", "political_structure", "time_period_start", "wikidata_qid", "confidence"],
  ["sumer", "Sumer", "City-states", "-4500", "Q35355", "0.95"],
];

const UR = [
  ["id", "name", "latitude", "longitude", "type", "civilization_id", "founded_year", "region"],
  ["ur", "Ur", "30.962", "46.103", "city-state", "sumer", "-3800", "Mesopotamia"],
];

const FRENCH = [
  ["id", "name", "iso639_1", "iso639_2", "glottocode", "parent_language_id", "wikidata_qid"],
  ["fr", "French", "fr", "fra", "stan1290", "", "Q150"],
  ["frp", "Arpitan", "", "frp", "fran1260", "fr", ""],
];

describe("export-insimul-pack (insimul-bridge US-002)", () => {
  describe("registry conformance (US-001 is the contract)", () => {
    it("every seed mapping is sanctioned by its predicate-mapping registry entry", () => {
      expect(() => assertSeedMappingsRegistered()).not.toThrow();
    });

    it("rejects a predicate the registry entry does not name", () => {
      const rogue: SeedMapping = {
        ...(seedMappingFor("culture") as SeedMapping),
        facts: [{ predicate: "country_law/3" }],
      };
      expect(() => assertSeedMappingsRegistered([rogue])).toThrow(
        /country_law\/3.*registry entry does not name/s,
      );
    });

    it("rejects an entry that is pending, local-only, or does not cross to Insimul", () => {
      // #9 (person/character) is IN->LS *and* pending an unlanded canonical addition.
      expect(() =>
        assertSeedMappingsRegistered([
          { nodeType: "character", relationId: 9, fields: [], facts: [] },
        ]),
      ).toThrow(/does not cross to Insimul/);
      // #19 is the local-only personal-tier catalogue entry.
      expect(() =>
        assertSeedMappingsRegistered([{ nodeType: "culture", relationId: 19, fields: [], facts: [] }]),
      ).toThrow(/canonical type the entry does not/);
      expect(() =>
        assertSeedMappingsRegistered([{ nodeType: "culture", relationId: 404, fields: [], facts: [] }]),
      ).toThrow(/names no registry entry/);
    });

    it("emits only predicates whose registry entry crosses LS->IN and is exportable", () => {
      for (const mapping of SEED_MAPPINGS) {
        const entry = registryEntryFor(mapping)!;
        expect(["LS->IN", "both"]).toContain(entry.direction);
        expect(entry.egress).toBe("exportable");
        expect(entry.pending).toBe(false);
        const named = new Set(externalPredicates(entry).map((p) => `${p.name}/${p.arity}`));
        for (const fact of mapping.facts) expect(named.has(fact.predicate)).toBe(true);
      }
    });

    it.skipIf(!hasInsimulCatalog)(
      "every emitted predicate is in Insimul's shipped predicate catalog (not just the registry)",
      () => {
        const source = fs.readFileSync(INSIMUL_PREDICATE_SCHEMA, "utf8");
        const shipped = new Set([...source.matchAll(/'([a-z][a-z0-9_]*\/\d+)'/g)].map((m) => m[1]));
        expect(shipped.size).toBeGreaterThan(50);
        for (const mapping of SEED_MAPPINGS) {
          for (const fact of mapping.facts) expect(shipped).toContain(fact.predicate);
        }
      },
    );
  });

  describe("prolog atoms", () => {
    it("emits bare atoms where legal and quotes/escapes otherwise", () => {
      expect(prologAtom("real")).toBe("real");
      expect(prologAtom("city_state")).toBe("city_state");
      expect(prologAtom("city-state")).toBe("'city-state'");
      expect(prologAtom("Sumer")).toBe("'Sumer'");
      expect(prologAtom("cs:culture:Q35355")).toBe("'cs:culture:Q35355'");
      expect(prologAtom("baker's yeast")).toBe("'baker\\'s yeast'");
      expect(prologAtom("back\\slash")).toBe("'back\\\\slash'");
    });
  });

  describe("entity mapping", () => {
    it("seeds a culture as an Insimul country", () => {
      withCorpus({ "civilizations.tsv": SUMER }, (build) => {
        const pack = build();
        const [culture] = pack.entities;
        expect(culture.csid).toBe("cs:culture:Q35355");
        expect(culture.entityType).toBe("culture");
        expect(culture.fields).toMatchObject({
          name: "Sumer",
          governmentType: "City-states",
          foundedYear: -4500,
        });
        expect(pack.prologFacts).toEqual([
          "country('cs:culture:Q35355').",
          "country_name('cs:culture:Q35355', 'Sumer').",
          "government_type('cs:culture:Q35355', 'City-states').",
          "country_founded('cs:culture:Q35355', -4500).",
        ]);
      });
    });

    it("carries real settlement coordinates and links the settlement to its country", () => {
      withCorpus({ "civilizations.tsv": SUMER, "settlements.tsv": UR }, (build) => {
        const pack = build();
        const ur = pack.entities.find((e) => e.csid === "cs:place:ur")!;
        // Coordinates are numbers, not strings — Insimul lays streets out around them.
        expect(ur.fields.lat).toBe(30.962);
        expect(ur.fields.lon).toBe(46.103);
        expect(ur.fields.settlementType).toBe("city-state");
        // The FK resolves through the culture's QID-anchored csid, not its raw lexicon id.
        expect(pack.prologFacts).toContain(
          "settlement_of_country('cs:place:ur', 'cs:culture:Q35355').",
        );
        expect(pack.prologFacts).toContain("settlement_name('cs:place:ur', 'Ur').");
      });
    });

    it("splits a combined JSON coordinates cell", () => {
      withCorpus({
        "archaeological-sites.tsv": [
          ["id", "name", "coordinates", "site_type"],
          ["catalhoyuk", "Çatalhöyük", '{"lat":37.666,"lng":32.826}', "tell"],
        ],
      }, (build) => {
        const [site] = build().entities;
        expect(site.fields.lat).toBe(37.666);
        expect(site.fields.lon).toBe(32.826);
      });
    });

    it("seeds a language as a WorldLanguage with its real code and parent", () => {
      withCorpus({ "languages.tsv": FRENCH }, (build) => {
        const pack = build();
        const arpitan = pack.entities.find((e) => e.csid === "cs:language:frp")!;
        expect(arpitan.fields).toMatchObject({ realCode: "frp", glottocode: "fran1260" });
        expect(pack.prologFacts).toContain("language('cs:language:Q150').");
        expect(pack.prologFacts).toContain("language_kind('cs:language:Q150', real).");
        expect(pack.prologFacts).toContain("language_real_code('cs:language:Q150', fr).");
        expect(pack.prologFacts).toContain(
          "language_parent('cs:language:frp', 'cs:language:Q150').",
        );
      });
    });

    it("never emits a foreign key that points outside the pack", () => {
      // The culture is license-excluded, so the settlement's country fact must not be emitted.
      withCorpus(
        {
          "civilizations.tsv": [
            [...SUMER[0], "license"],
            [...SUMER[1], "CC-BY-SA-4.0"],
          ],
          "settlements.tsv": UR,
        },
        (build) => {
          const pack = build();
          expect(pack.entities.map((e) => e.csid)).toEqual(["cs:place:ur"]);
          expect(pack.prologFacts).toContain("settlement('cs:place:ur').");
          expect(pack.prologFacts.some((f) => f.startsWith("settlement_of_country"))).toBe(false);
        },
      );
    });

    it("skips a fact whose source cell is blank or non-numeric rather than faking one", () => {
      withCorpus(
        {
          "civilizations.tsv": [
            ["id", "name", "political_structure", "time_period_start"],
            ["nolo", "Nolo", "", "circa 4000 BCE"],
          ],
        },
        (build) => {
          const pack = build();
          expect(pack.prologFacts).toEqual([
            "country('cs:culture:nolo').",
            "country_name('cs:culture:nolo', 'Nolo').",
          ]);
          expect(pack.entities[0].fields.foundedYear).toBeUndefined();
        },
      );
    });
  });

  describe("license filtering + manifest", () => {
    const mixed = {
      "languages.tsv": [
        ["id", "name", "iso639_1", "license"],
        ["def", "Default", "a", ""],
        ["zero", "Zero", "b", "CC0-1.0"],
        ["sa", "Share", "c", "CC-BY-SA-4.0"],
      ],
    };

    it("excludes share-alike by default and reports both sides in the manifest", () => {
      withCorpus(mixed, (build) => {
        const pack = build();
        expect(pack.entities.map((e) => e.csid).sort()).toEqual([
          "cs:language:def",
          "cs:language:zero",
        ]);
        expect(pack.licenseManifest.allowedSpdxClasses).toEqual([...DEFAULT_LICENSE_CLASSES]);
        expect(pack.licenseManifest.policy.allowed_classes).toEqual([
          "public-domain",
          "attribution",
        ]);
        expect(pack.licenseManifest.included).toEqual({
          count: 2,
          byLicense: { "CC-BY-4.0": 1, "CC0-1.0": 1 },
          byClass: { "CC-BY": 1, CC0: 1 },
        });
        expect(pack.licenseManifest.excluded).toEqual({
          count: 1,
          byLicense: { "CC-BY-SA-4.0": 1 },
          byClass: { "CC-BY-SA": 1 },
        });
        // No excluded record leaks into the facts.
        expect(pack.prologFacts.some((f) => f.includes("cs:language:sa"))).toBe(false);
      });
    });

    it("widening the class list admits the share-alike record", () => {
      withCorpus(mixed, (build) => {
        const pack = build({ licenseClasses: ["CC0", "CC-BY", "CC-BY-SA"] });
        expect(pack.entities.map((e) => e.csid)).toContain("cs:language:sa");
        expect(pack.licenseManifest.excluded.count).toBe(0);
        expect(pack.licenseManifest.policy.allowed_classes).toContain("share-alike");
      });
    });

    it("fails with a clear message when the schema has no per-record license column", () => {
      expect(() => assertLicenseColumn(["source", "confidence"])).toThrow(
        /no per-record "license" provenance column.*v1\.1\+/s,
      );
      expect(() => assertLicenseColumn()).not.toThrow();
    });
  });

  describe("domain filtering", () => {
    it("keeps only the requested entity-type domains, and records the filter", () => {
      withCorpus({ "civilizations.tsv": SUMER, "languages.tsv": FRENCH }, (build) => {
        const pack = build({ domains: ["language"] });
        expect(new Set(pack.entities.map((e) => e.entityType))).toEqual(new Set(["language"]));
        expect(pack.domains).toEqual(["language"]);
        expect(pack.prologFacts.every((f) => !f.startsWith("country"))).toBe(true);
      });
    });
  });

  describe("determinism", () => {
    it("is byte-identical across re-runs and content-addressed independent of generatedAt", () => {
      withCorpus({ "civilizations.tsv": SUMER, "settlements.tsv": UR }, (build, dir) => {
        expect(packJson(build())).toEqual(packJson(build()));
        const later = buildInsimulPack({
          lexiconsDir: dir,
          generatedAt: "2099-01-01T00:00:00.000Z",
        });
        expect(later.packId).toBe(build().packId);
        // Different knowledge ⇒ different address.
        expect(build({ domains: ["culture"] }).packId).not.toBe(build().packId);
        expect(build({ licenseClasses: ["CC0"] }).packId).not.toBe(build().packId);
      });
    });

    it("writes grounding-pack.json under the out dir", () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-insimul-out-"));
      try {
        writeInsimulPack(buildFixturePack(), outDir);
        const onDisk = JSON.parse(
          fs.readFileSync(path.join(outDir, "grounding-pack.json"), "utf8"),
        );
        expect(onDisk.contractVersion).toBe(INSIMUL_CONTRACT_VERSION);
        expect(onDisk.source).toBe(INSIMUL_SOURCE);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it("parses CLI flags", () => {
      expect(parseArgs(["--domains", "culture, place", "--license-classes", "CC0"])).toMatchObject({
        domains: ["culture", "place"],
        licenseClasses: ["CC0"],
      });
      expect(parseArgs(["--emit-fixture"]).emitFixture).toBe(true);
      expect(parseArgs([]).licenseClasses).toEqual([...DEFAULT_LICENSE_CLASSES]);
    });
  });

  describe("consumer schema (@insimul/core grounding-pack.schema.json)", () => {
    it("the committed fixture pack validates against the vendored schema", () => {
      expect(validateJsonSchema(buildFixturePack(), loadInsimulSchema())).toEqual([]);
    });

    it("catches a pack that violates the contract", () => {
      const bad = { ...buildFixturePack(), contractVersion: "wrong" } as InsimulGroundingPack;
      expect(validateJsonSchema(bad, loadInsimulSchema())).toEqual([
        expect.stringContaining("expected const"),
      ]);
      const { prologFacts: _dropped, ...missing } = buildFixturePack();
      expect(validateJsonSchema(missing, loadInsimulSchema())).toEqual([
        expect.stringContaining('missing required property "prologFacts"'),
      ]);
      expect(() => assertMatchesInsimulSchema(bad)).toThrow(/groundingPackSchema/);
    });

    it.skipIf(!hasInsimulSchema)(
      "the vendored schema is byte-identical to Insimul's shipped copy",
      () => {
        expect(fs.readFileSync(INSIMUL_SCHEMA_PATH, "utf8")).toEqual(
          fs.readFileSync(INSIMUL_SCHEMA, "utf8"),
        );
      },
    );
  });

  describe("committed fixture pack", () => {
    it("is in sync with a fresh build of the fixture lexicons", () => {
      expect(packJson(buildFixturePack())).toEqual(fs.readFileSync(FIXTURE_PACK_PATH, "utf8"));
    });

    it("pins the timestamp and carries the registry version it was sanctioned by", () => {
      const pack = buildFixturePack();
      expect(pack.generatedAt).toBe(FIXTURE_GENERATED_AT);
      expect(pack.x_pinakes.registryVersion).toBe(PREDICATE_MAPPING.registryVersion);
      expect(pack.x_pinakes.kgpPackId).toMatch(/^sha256-[0-9a-f]{64}$/);
    });
  });

  describe("live corpus", () => {
    it("builds a schema-valid pack whose facts only mention entities it ships", () => {
      const pack = buildInsimulPack({ generatedAt: "2026-01-01T00:00:00.000Z" });
      expect(pack.entities.length).toBeGreaterThan(0);
      expect(pack.prologFacts.length).toBeGreaterThan(0);
      expect(validateJsonSchema(JSON.parse(JSON.stringify(pack)), loadInsimulSchema())).toEqual([]);

      const shipped = new Set(pack.entities.map((e) => e.csid));
      for (const fact of pack.prologFacts) {
        for (const csid of fact.match(/cs:[a-z-]+:[^']+/g) ?? []) {
          expect(shipped.has(csid)).toBe(true);
        }
      }
    });

    it("agrees with the KGP pack on which entities the corpus slice contains", () => {
      const pack = buildInsimulPack({ generatedAt: "T" });
      const kgp = buildEntityGrounding();
      expect(pack.entities.map((e) => e.csid)).toEqual(kgp.map((e) => e.csid));
    });
  });

  describe("seed index", () => {
    it("keys seeds by the same csid the entity builder mints", () => {
      withCorpus({ "civilizations.tsv": SUMER, "settlements.tsv": UR }, (_build, dir) => {
        const { seeds, idIndex } = buildSeedIndex(dir);
        expect([...seeds.keys()].sort()).toEqual(["cs:culture:Q35355", "cs:place:ur"]);
        expect(idIndex.get(seedRefKey("culture", "sumer"))).toBe("cs:culture:Q35355");
        const entities = buildEntityGrounding(dir);
        expect(buildPrologFacts(entities, { seeds, idIndex }).length).toBeGreaterThan(0);
      });
    });
  });
});
