import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  computeCoverage,
  buildCoverageReport,
  generateDataQualityReport,
  computeCorpusTiers,
  buildCorpusTierReport,
  ROADMAP_TARGETS,
} from "./data-quality-scorer";
import { ALL_TRUST_TIERS } from "@contracts/trust-tier";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "../../data/source/lexicons");
const COMMITTED_REPORT = path.resolve(import.meta.dirname, "../../docs/coverage-report.json");
const COMMITTED_TIER_REPORT = path.resolve(
  import.meta.dirname,
  "../../docs/corpus-tier-report.json",
);

describe("computeCoverage (pure)", () => {
  it("flags a domain over its target as met with % > 100", () => {
    const report = computeCoverage({ "civilizations.tsv": 170 });
    const civ = report.domains.find((d) => d.domain === "civilizations");
    expect(civ).toBeDefined();
    expect(civ!.met).toBe(true);
    expect(civ!.actual).toBe(170);
    // percentOfTarget is rounded to 3 decimals: 170/150 = 1.1333… -> 1.133
    expect(civ!.percentOfTarget).toBe(1.133);
  });

  it("flags a domain under its target as not met and lists it in underTarget", () => {
    const report = computeCoverage({ "language-range-polygons.tsv": 133 });
    const poly = report.domains.find((d) => d.domain === "language-range-polygons");
    expect(poly!.met).toBe(false);
    expect(report.underTarget).toContain("language-range-polygons");
    expect(report.allMet).toBe(false);
  });

  it("treats a missing/uncounted domain as 0 actual (under target)", () => {
    const report = computeCoverage({});
    expect(report.domainsMet).toBe(0);
    expect(report.domainsUnderTarget).toBe(ROADMAP_TARGETS.length);
    expect(report.allMet).toBe(false);
    for (const d of report.domains) expect(d.actual).toBe(0);
  });

  it("a domain exactly at target counts as met (>=, not >)", () => {
    const report = computeCoverage({ "cuisines.tsv": 80 });
    expect(report.domains.find((d) => d.domain === "cuisines")!.met).toBe(true);
  });

  it("domainsMet + domainsUnderTarget always equals the target count", () => {
    const report = computeCoverage({ "civilizations.tsv": 170, "cuisines.tsv": 10 });
    expect(report.domainsMet + report.domainsUnderTarget).toBe(ROADMAP_TARGETS.length);
  });
});

describe("coverage against the live corpus", () => {
  it("the committed docs/coverage-report.json matches a fresh build of the live corpus", () => {
    const fresh = buildCoverageReport(LEXICONS_DIR);
    const committed = JSON.parse(fs.readFileSync(COMMITTED_REPORT, "utf-8"));
    expect(committed).toEqual(fresh);
  });

  it("every tracked target file exists in data/source/lexicons/", () => {
    for (const t of ROADMAP_TARGETS) {
      expect(fs.existsSync(path.join(LEXICONS_DIR, t.file))).toBe(true);
    }
  });

  it("generateDataQualityReport surfaces the coverage section", () => {
    const report = generateDataQualityReport();
    expect(report.coverage).toBeDefined();
    expect(report.coverage.domains.length).toBe(ROADMAP_TARGETS.length);
    // Coverage row counts agree with the per-file scores in the same report.
    for (const d of report.coverage.domains) {
      const file = report.files.find((f) => f.file === d.file);
      if (file) expect(d.actual).toBe(file.rowCount);
    }
  });
});

describe("computeCorpusTiers (pure)", () => {
  const header = ["id", "name", "wikidata_qid", "source_url", "confidence"];

  it("auto-admits a QID-anchored + reference-backed row, quarantines the rest", () => {
    const report = computeCorpusTiers([
      {
        file: "t.tsv",
        node: "place",
        header,
        rows: [
          ["a", "A", "Q1", "https://x.test", "0.9"], // qid + url -> auto-admitted
          ["b", "B", "Q2", "", "0.8"], // qid, no url -> quarantine
          ["c", "C", "", "https://y.test", "0.8"], // url, no qid -> quarantine
          ["d", "D", "", "", ""], // bare -> quarantine
        ],
      },
    ]);
    const auto = report.byTier.find((b) => b.tier === "auto-admitted")!;
    const quar = report.byTier.find((b) => b.tier === "quarantine")!;
    expect(auto.nodeRows).toBe(1);
    expect(auto.fullyProvenanced).toBe(1);
    expect(quar.nodeRows).toBe(3);
    expect(report.totalNodeRows).toBe(4);
    expect(report.autoAdmissionReadyRate).toBe(0.25);
    expect(report.graphTier).toBe("curated");
  });

  it("normalises a 0–100 confidence scale into avgConfidence", () => {
    const report = computeCorpusTiers([
      {
        file: "t.tsv",
        node: "place",
        header,
        rows: [["a", "A", "Q1", "https://x.test", "90"]],
      },
    ]);
    expect(report.byTier.find((b) => b.tier === "auto-admitted")!.avgConfidence).toBe(0.9);
  });

  it("emits a bucket for every tier in ALL_TRUST_TIERS order", () => {
    const report = computeCorpusTiers([]);
    expect(report.byTier.map((b) => b.tier)).toEqual([...ALL_TRUST_TIERS]);
    expect(report.totalNodeRows).toBe(0);
    expect(report.autoAdmissionReadyRate).toBe(0);
  });
});

describe("corpus tiers against the live corpus", () => {
  it("the committed docs/corpus-tier-report.json matches a fresh build", () => {
    const fresh = buildCorpusTierReport(LEXICONS_DIR);
    const committed = JSON.parse(fs.readFileSync(COMMITTED_TIER_REPORT, "utf-8"));
    expect(committed).toEqual(fresh);
  });

  it("generateDataQualityReport surfaces the tierComposition section", () => {
    const report = generateDataQualityReport();
    expect(report.tierComposition).toBeDefined();
    expect(report.tierComposition.graphTier).toBe("curated");
    // Every node row is classified into exactly one tier.
    const summed = report.tierComposition.byTier.reduce((s, b) => s + b.nodeRows, 0);
    expect(summed).toBe(report.tierComposition.totalNodeRows);
    expect(report.tierComposition.totalNodeRows).toBeGreaterThan(0);
  });
});
