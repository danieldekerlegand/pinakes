import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lexiconMappingByFile } from "@shared/lexicon-mapping";
import {
  buildConvergenceQA,
  detectDrift,
  detectAttributionGaps,
  detectRegressions,
  detectRegistryStaleness,
  formatMarkdown,
  loadBaseline,
  reportJson,
  writeConvergenceQA,
  runQA,
  IMPORT_MARKER_TARGET,
  REQUIRED_IMPORT_PROVENANCE_TARGETS,
  type IdentityMetrics,
  type ReconciliationMetrics,
  type RegressionBaseline,
  type RegistryStalenessProbe,
} from "./convergence-qa";

/** The real corpus — the clean baseline the gate must pass on. */
const REAL_LEXICONS = path.resolve(process.cwd(), "lexicons");

/** Fresh temp dir; caller removes it. */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ls-qa-"));
}

/**
 * Write a *clean* fixture copy of one mapped node file: header = exactly the mapped
 * columns (so no column drift), plus a single data row keyed by `id`.
 */
function writeCleanMappedFile(dir: string, file: string, id: string): string[] {
  const mapping = lexiconMappingByFile(file);
  if (mapping === undefined) throw new Error(`no mapping for ${file}`);
  const header = mapping.columns.map((c) => c.column);
  const row = header.map((c) => (c === "id" ? id : c === "name" ? id : ""));
  fs.writeFileSync(
    path.join(dir, file),
    [header.join("\t"), row.join("\t")].join("\n") + "\n",
  );
  return header;
}

describe("convergence-qa (US-008)", () => {
  describe("detectDrift", () => {
    it("reports no drift on the real lexicons corpus (clean)", () => {
      expect(detectDrift(REAL_LEXICONS)).toEqual([]);
    });

    it("flags an unmapped lexicon file on disk", () => {
      const dir = tmpDir();
      try {
        fs.writeFileSync(
          path.join(dir, "totally-unmapped.tsv"),
          "id\tname\nx\tX\n",
        );
        const drift = detectDrift(dir);
        expect(drift.some((d) => d.kind === "unmapped-lexicon-file")).toBe(true);
        expect(
          drift.find((d) => d.kind === "unmapped-lexicon-file")?.file,
        ).toBe("totally-unmapped.tsv");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("flags a mapped column renamed/removed from a live header", () => {
      const dir = tmpDir();
      try {
        const header = writeCleanMappedFile(dir, "cuisines.tsv", "thai");
        // Drop a mapped column ("region") from the header to simulate a rename.
        const dropped = header.filter((c) => c !== "region");
        fs.writeFileSync(
          path.join(dir, "cuisines.tsv"),
          [dropped.join("\t"), dropped.map(() => "").join("\t")].join("\n") + "\n",
        );
        const drift = detectDrift(dir);
        const miss = drift.find((d) => d.kind === "missing-source-column");
        expect(miss).toBeDefined();
        expect(miss?.file).toBe("cuisines.tsv");
        expect(miss?.message).toContain("region");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("treats a subset of mapped files (present, intact) as clean", () => {
      const dir = tmpDir();
      try {
        writeCleanMappedFile(dir, "cuisines.tsv", "thai");
        // A mapped file absent from disk is NOT drift (fixtures carry a subset).
        expect(detectDrift(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // US-3: the koine registry-mirror staleness gate. Both directions are driven through an
  // injected probe so the test never depends on the sibling koine checkout being present
  // (or on the live mirror's freshness), mirroring the "simulate an unmapped file" tests.
  describe("detectRegistryStaleness (registry mirror drift)", () => {
    const probe = (over: Partial<RegistryStalenessProbe> = {}): RegistryStalenessProbe => ({
      koinePresent: true,
      diff: () => ({ jsonChanged: false, kgpChanged: false }),
      ...over,
    });

    it("no finding when no koine checkout is present (the blind-spot guard)", () => {
      // Without the sibling repo the gate is a no-op — diff() must never even be called.
      expect(
        detectRegistryStaleness(
          probe({
            koinePresent: false,
            diff: () => {
              throw new Error("diff must not run without a koine checkout");
            },
          }),
        ),
      ).toEqual([]);
    });

    it("no finding when both mirrors are fresh", () => {
      expect(detectRegistryStaleness(probe())).toEqual([]);
    });

    it("exactly one finding when the JSON mirror is stale, naming the regen remedy", () => {
      const drift = detectRegistryStaleness(
        probe({ diff: () => ({ jsonChanged: true, kgpChanged: false }) }),
      );
      expect(drift).toHaveLength(1);
      expect(drift[0].kind).toBe("registry-stale");
      expect(drift[0].message).toContain("shared/predicate-mapping.json");
      expect(drift[0].message).toContain("npm run regen:registry-mirror");
      expect(drift[0].message).toMatch(/never hand-edit/i);
    });

    it("exactly one finding when the kgp.ts TSV vocabulary is stale", () => {
      const drift = detectRegistryStaleness(
        probe({ diff: () => ({ jsonChanged: false, kgpChanged: true }) }),
      );
      expect(drift).toHaveLength(1);
      expect(drift[0].kind).toBe("registry-stale");
      expect(drift[0].message).toContain("shared/kgp.ts");
    });

    it("still exactly one finding when BOTH mirrors are stale (one issue, both named)", () => {
      const drift = detectRegistryStaleness(
        probe({ diff: () => ({ jsonChanged: true, kgpChanged: true }) }),
      );
      expect(drift).toHaveLength(1);
      expect(drift[0].message).toContain("shared/predicate-mapping.json");
      expect(drift[0].message).toContain("shared/kgp.ts");
    });

    it("a broken (present but unreadable) checkout fails the gate rather than crashing", () => {
      const drift = detectRegistryStaleness(
        probe({
          diff: () => {
            throw new Error("koine source file not found: registry/relations.tsv");
          },
        }),
      );
      expect(drift).toHaveLength(1);
      expect(drift[0].kind).toBe("registry-stale");
      expect(drift[0].message).toContain("npm run regen:registry-mirror");
    });

    it("a stale mirror fails the whole gate (report.ok === false, exit 1)", () => {
      const staleProbe = probe({ diff: () => ({ jsonChanged: true, kgpChanged: false }) });
      const drift = detectDrift(REAL_LEXICONS, { registryProbe: staleProbe });
      expect(drift.some((d) => d.kind === "registry-stale")).toBe(true);

      const report = buildConvergenceQA(REAL_LEXICONS, { registryProbe: staleProbe });
      expect(report.ok).toBe(false);
      expect(report.drift.filter((d) => d.kind === "registry-stale")).toHaveLength(1);

      const outDir = tmpDir();
      try {
        const { exitCode } = runQA({
          lexiconsDir: REAL_LEXICONS,
          outDir,
          registryProbe: staleProbe,
        });
        expect(exitCode).toBe(1);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it("a fresh mirror adds no staleness finding to the real-corpus gate", () => {
      const freshProbe = probe(); // koinePresent + both unchanged
      const drift = detectDrift(REAL_LEXICONS, { registryProbe: freshProbe });
      expect(drift.filter((d) => d.kind === "registry-stale")).toEqual([]);
      const report = buildConvergenceQA(REAL_LEXICONS, { registryProbe: freshProbe });
      expect(report.ok).toBe(true);
    });
  });

  /**
   * Write a mapped node file with a header of exactly the mapped columns and the given
   * data rows (each a `column → value` map; unset columns are blank). Lets a test control
   * the import marker + provenance cells for the attribution gate.
   */
  function writeMappedFileWithRows(
    dir: string,
    file: string,
    rows: Record<string, string>[],
  ): void {
    const mapping = lexiconMappingByFile(file);
    if (mapping === undefined) throw new Error(`no mapping for ${file}`);
    const header = mapping.columns.map((c) => c.column);
    const body = rows.map((r) => header.map((c) => r[c] ?? "").join("\t"));
    fs.writeFileSync(path.join(dir, file), [header.join("\t"), ...body].join("\n") + "\n");
  }

  /** Column in a mapped file that carries a given canonical target. */
  function columnFor(file: string, target: string): string {
    const col = lexiconMappingByFile(file)?.columns.find((c) => c.target === target)?.column;
    if (col === undefined) throw new Error(`${file} has no column for target ${target}`);
    return col;
  }

  describe("detectAttributionGaps (US-001)", () => {
    it("requires source + source_url + retrieved_at + confidence on imported rows", () => {
      expect([...REQUIRED_IMPORT_PROVENANCE_TARGETS]).toEqual([
        "source",
        "source_url",
        "retrieved_at",
        "confidence",
      ]);
    });

    it("no gaps on the real corpus (every imported row is provenanced)", () => {
      expect(detectAttributionGaps(REAL_LEXICONS)).toEqual([]);
    });

    it("flags an imported row missing a required provenance field", () => {
      const dir = tmpDir();
      try {
        const marker = columnFor("civilizations.tsv", IMPORT_MARKER_TARGET);
        const url = columnFor("civilizations.tsv", "source_url");
        const full: Record<string, string> = {
          id: "acme",
          name: "Acme",
          [marker]: "Q1",
          [columnFor("civilizations.tsv", "source")]: '["Wikidata"]',
          [url]: "http://www.wikidata.org/entity/Q1",
          [columnFor("civilizations.tsv", "retrieved_at")]: "2026-07-08T00:00:00Z",
          [columnFor("civilizations.tsv", "confidence")]: "1.0",
        };
        // A second imported row missing source_url; plus a curated (no-marker) blank row.
        const missingUrl = { ...full, id: "beta", name: "Beta", [url]: "" };
        const curated = { id: "seed", name: "Seed" };
        writeMappedFileWithRows(dir, "civilizations.tsv", [full, missingUrl, curated]);

        const gaps = detectAttributionGaps(dir);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].file).toBe("civilizations.tsv");
        expect(gaps[0].rowId).toBe("beta");
        expect(gaps[0].missing).toContain("source_url");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("ignores curated rows (no import marker → provenance not required)", () => {
      const dir = tmpDir();
      try {
        writeMappedFileWithRows(dir, "civilizations.tsv", [
          { id: "seed", name: "Seed" }, // no wikidata_qid, all provenance blank — fine.
        ]);
        expect(detectAttributionGaps(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("skips files with no import-marker column (all curated)", () => {
      const dir = tmpDir();
      try {
        // cuisines.tsv has no wikidata_qid mapping → no imported rows possible.
        writeCleanMappedFile(dir, "cuisines.tsv", "thai");
        expect(detectAttributionGaps(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("detectRegressions (US-001)", () => {
    const id = (over: Partial<IdentityMetrics> = {}): IdentityMetrics => ({
      nodes: 100,
      anchoredOverlap: 10,
      overlapRate: 0.1,
      duplicateCsids: 44,
      ambiguousPinakesIds: 16,
      edgesWithUnresolvedEndpoint: 139,
      ...over,
    });
    const recon = (over: Partial<ReconciliationMetrics> = {}): ReconciliationMetrics => ({
      nodes: 100,
      matched: 10,
      ambiguous: 242,
      likelyNew: 20,
      unreconciledRate: 0.5,
      ...over,
    });
    const baseline: RegressionBaseline = {
      duplicateCsids: 44,
      ambiguousPinakesIds: 16,
      edgesWithUnresolvedEndpoint: 139,
      reconciliationAmbiguous: 242,
    };

    it("no issue when metrics sit at or below baseline", () => {
      expect(detectRegressions(id(), recon(), baseline)).toEqual([]);
      expect(
        detectRegressions(id({ duplicateCsids: 40 }), recon({ ambiguous: 200 }), baseline),
      ).toEqual([]);
    });

    it("flags a metric that exceeded its ceiling", () => {
      const issues = detectRegressions(id({ duplicateCsids: 45 }), recon(), baseline);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ metric: "duplicateCsids", baseline: 44, current: 45 });
    });

    it("no ratchet when the baseline is absent", () => {
      expect(detectRegressions(id({ duplicateCsids: 999 }), recon(), undefined)).toEqual([]);
    });
  });

  describe("committed baseline", () => {
    it("loads and covers every ratcheted metric", () => {
      const b = loadBaseline();
      expect(b).toBeDefined();
      for (const k of [
        "duplicateCsids",
        "ambiguousPinakesIds",
        "edgesWithUnresolvedEndpoint",
        "reconciliationAmbiguous",
      ] as const) {
        expect(typeof b?.[k]).toBe("number");
      }
    });

    it("the live corpus sits at or below the committed baseline", () => {
      // The gate must be green on `main`: no metric may exceed its committed ceiling.
      const report = buildConvergenceQA(REAL_LEXICONS);
      expect(report.regressions).toEqual([]);
    });
  });

  describe("buildConvergenceQA — clean corpus passes the gate", () => {
    const report = buildConvergenceQA(REAL_LEXICONS);

    it("ok === true with an empty drift list", () => {
      expect(report.ok).toBe(true);
      expect(report.drift).toEqual([]);
    });

    it("reports sane id-overlap / unreconciled metrics", () => {
      const { identity, reconciliation } = report.metrics;
      expect(identity.nodes).toBeGreaterThan(0);
      expect(identity.overlapRate).toBeGreaterThanOrEqual(0);
      expect(identity.overlapRate).toBeLessThanOrEqual(1);
      expect(reconciliation.unreconciledRate).toBeGreaterThanOrEqual(0);
      expect(reconciliation.unreconciledRate).toBeLessThanOrEqual(1);
      // matched + ambiguous + likely-new partition the node set.
      expect(
        reconciliation.matched + reconciliation.ambiguous + reconciliation.likelyNew,
      ).toBe(reconciliation.nodes);
    });

    it("reports provenance completeness with source at 100%", () => {
      const { node, edge } = report.metrics.provenance;
      // US-006: source is stamped on every row.
      expect(node.completeness.source).toBe(1);
      expect(edge.completeness.source).toBe(1);
      expect(node.total).toBeGreaterThan(0);
    });

    it("captures the canonical schema shape", () => {
      const s = report.metrics.schema;
      expect(s.nodeTypes).toBeGreaterThan(0);
      expect(s.edgeTypes).toBeGreaterThan(0);
      expect(s.nodeColumns).toBeGreaterThan(0);
    });
  });

  describe("buildConvergenceQA — drifted corpus fails the gate", () => {
    it("ok === false when an unmapped file is present", () => {
      const dir = tmpDir();
      try {
        writeCleanMappedFile(dir, "cuisines.tsv", "thai");
        fs.writeFileSync(path.join(dir, "rogue.tsv"), "id\tname\nx\tX\n");
        const report = buildConvergenceQA(dir);
        expect(report.ok).toBe(false);
        expect(report.drift.some((d) => d.kind === "unmapped-lexicon-file")).toBe(
          true,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("artifact rendering + write", () => {
    it("formats a human-readable Markdown report", () => {
      const report = buildConvergenceQA(REAL_LEXICONS);
      const md = formatMarkdown(report);
      expect(md).toContain("# Convergence QA report");
      expect(md).toContain("id-overlap");
      expect(md).toContain("Unreconciled rate");
      expect(md).toContain("Provenance completeness");
      expect(md).toContain(report.ok ? "PASS" : "FAIL");
    });

    it("writeConvergenceQA emits json + md; runQA returns the exit code", () => {
      const outDir = tmpDir();
      try {
        const report = buildConvergenceQA(REAL_LEXICONS);
        writeConvergenceQA(report, outDir);
        expect(fs.existsSync(path.join(outDir, "convergence-qa.json"))).toBe(true);
        expect(fs.existsSync(path.join(outDir, "convergence-qa.md"))).toBe(true);
        // JSON round-trips.
        const parsed = JSON.parse(reportJson(report));
        expect(parsed.ok).toBe(report.ok);

        const clean = runQA({ lexiconsDir: REAL_LEXICONS, outDir });
        expect(clean.exitCode).toBe(0);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it("runQA exits non-zero on a drifted corpus", () => {
      const dir = tmpDir();
      const outDir = tmpDir();
      try {
        fs.writeFileSync(path.join(dir, "rogue.tsv"), "id\tname\nx\tX\n");
        const { exitCode, report } = runQA({ lexiconsDir: dir, outDir });
        expect(exitCode).toBe(1);
        expect(report.ok).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });
});
