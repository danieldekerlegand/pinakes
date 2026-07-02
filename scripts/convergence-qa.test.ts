import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lexiconMappingByFile } from "@shared/lexicon-mapping";
import {
  buildConvergenceQA,
  detectDrift,
  formatMarkdown,
  reportJson,
  writeConvergenceQA,
  runQA,
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
