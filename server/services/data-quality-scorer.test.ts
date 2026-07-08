import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  computeCoverage,
  buildCoverageReport,
  generateDataQualityReport,
  ROADMAP_TARGETS,
} from "./data-quality-scorer";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "../../lexicons");
const COMMITTED_REPORT = path.resolve(import.meta.dirname, "../../docs/coverage-report.json");

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

  it("every tracked target file exists in lexicons/", () => {
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
