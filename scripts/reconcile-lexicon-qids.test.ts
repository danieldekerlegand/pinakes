import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAddressableRows,
  exactLabelSparql,
  serializeCandidates,
  parseCandidates,
  detectConfidenceScale,
  applyAccepted,
  reconcileCitation,
  RETRIEVED_AT,
  type QidCandidate,
} from "./reconcile-lexicon-qids";

/** Write a `{ file: rows[][] }` map of TSVs into a fresh temp lexicons dir. */
function makeFixtureDir(files: Record<string, string[][]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-qid-"));
  for (const [file, rows] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), rows.map((r) => r.join("\t")).join("\n") + "\n");
  }
  return dir;
}

const readCell = (dir: string, file: string, id: string, col: string): string => {
  const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n").filter((l) => l.trim() !== "");
  const headers = lines[0].split("\t");
  const idIdx = headers.indexOf("id");
  const colIdx = headers.indexOf(col);
  const row = lines.slice(1).map((l) => l.split("\t")).find((r) => r[idIdx] === id);
  return row ? (row[colIdx] ?? "") : "<no-row>";
};

describe("reconcile-lexicon-qids (US-003)", () => {
  describe("readAddressableRows", () => {
    it("keeps only blank-qid, uniquely-id'd, named rows", () => {
      const dir = makeFixtureDir({
        "writing-systems.tsv": [
          ["id", "name", "wikidata_qid", "source_url", "retrieved_at", "confidence", "sources"],
          ["cuneiform", "Cuneiform", "", "", "", "", ""], // addressable
          ["hieroglyphs", "Egyptian hieroglyphs", "Q43450", "", "", "", ""], // already has qid
          ["blank-name", "", "", "", "", "", ""], // no name
          ["dupe", "One", "", "", "", "", ""], // duplicated id → not addressable
          ["dupe", "Two", "", "", "", "", ""],
        ],
      });
      try {
        const rows = readAddressableRows(dir);
        expect(rows.map((r) => r.id)).toEqual(["cuneiform"]);
        expect(rows[0].name).toBe("Cuneiform");
        expect(rows[0].classQid).toBe("Q8192"); // writing-system class from QID_TARGETS
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("exactLabelSparql", () => {
    it("constrains to the class when one is given", () => {
      const q = exactLabelSparql(["Cuneiform"], "Q8192");
      expect(q).toContain('"Cuneiform"@en');
      expect(q).toContain("wdt:P31/wdt:P279* wd:Q8192");
      expect(q).not.toContain("Q4167410");
    });

    it("excludes Wikimedia internal pages for a global (class-less) match", () => {
      const q = exactLabelSparql(["Babylon"], "");
      expect(q).toContain("Q4167410"); // disambiguation
      expect(q).toContain("Q4167836"); // category
      expect(q).toContain("Q13406463"); // list article
      expect(q).not.toContain("wdt:P279*");
    });

    it("escapes quotes and backslashes in a label", () => {
      const q = exactLabelSparql(['A "quote" \\ path'], "");
      expect(q).toContain('A \\"quote\\" \\\\ path');
    });
  });

  describe("candidate artifact round-trip", () => {
    it("serialises and re-parses candidates losslessly and stably", () => {
      const candidates: QidCandidate[] = [
        { file: "b.tsv", node: "x", id: "z", name: "Z", status: "none", qid: "", candidateCount: 0, candidates: [] },
        { file: "a.tsv", node: "x", id: "y", name: "Y", status: "accepted", qid: "Q5", candidateCount: 1, candidates: ["Q5"] },
        { file: "a.tsv", node: "x", id: "w", name: "W", status: "ambiguous", qid: "", candidateCount: 2, candidates: ["Q7", "Q9"] },
      ];
      const tsv = serializeCandidates(candidates);
      // Sorted by (file, id): a/w, a/y, b/z.
      const body = tsv.trim().split("\n").slice(1).map((l) => l.split("\t")[2]);
      expect(body).toEqual(["w", "y", "z"]);
      const parsed = parseCandidates(tsv);
      const accepted = parsed.find((c) => c.id === "y")!;
      expect(accepted).toMatchObject({ status: "accepted", qid: "Q5", candidateCount: 1 });
      expect(parsed.find((c) => c.id === "w")!.candidates).toEqual(["Q7", "Q9"]);
    });
  });

  describe("detectConfidenceScale", () => {
    it("reports 100 when a value exceeds 1, else 1", () => {
      expect(detectConfidenceScale(["confidence"], [["90"], ["80"]])).toBe(100);
      expect(detectConfidenceScale(["confidence"], [["0.9"], ["0.8"]])).toBe(1);
      expect(detectConfidenceScale(["name"], [["x"]])).toBe(1); // no confidence column
    });
  });

  describe("applyAccepted", () => {
    it("fills blank qid + provenance on accepted rows, on the file's own confidence scale", () => {
      const dir = makeFixtureDir({
        "writing-systems.tsv": [
          ["id", "name", "wikidata_qid", "source_url", "retrieved_at", "confidence", "sources"],
          ["cuneiform", "Cuneiform", "", "", "", "", ""],
          ["curated", "Curated", "", "", "", "0.8", "hand"], // pre-existing confidence/sources
        ],
        "archaeological-sites.tsv": [
          ["id", "name", "wikidata_qid", "source_url", "retrieved_at", "confidence", "sources"],
          ["carthage-site", "Carthage", "", "", "", "90", ""], // 0–100 scale
        ],
      });
      const candidates: QidCandidate[] = [
        { file: "writing-systems.tsv", node: "writing-system", id: "cuneiform", name: "Cuneiform", status: "accepted", qid: "Q401", candidateCount: 1, candidates: ["Q401"] },
        { file: "writing-systems.tsv", node: "writing-system", id: "curated", name: "Curated", status: "accepted", qid: "Q999", candidateCount: 1, candidates: ["Q999"] },
        { file: "archaeological-sites.tsv", node: "place", id: "carthage-site", name: "Carthage", status: "accepted", qid: "Q6343", candidateCount: 1, candidates: ["Q6343"] },
        // An ambiguous candidate is never applied.
        { file: "writing-systems.tsv", node: "writing-system", id: "cuneiform", name: "Cuneiform", status: "ambiguous", qid: "", candidateCount: 2, candidates: ["Q1", "Q2"] },
      ];
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-qid-out-"));
      try {
        applyAccepted(candidates, { lexiconsDir: dir, outDir });

        // Fresh row: all five provenance cells filled, 0–1 scale confidence.
        expect(readCell(dir, "writing-systems.tsv", "cuneiform", "wikidata_qid")).toBe("Q401");
        expect(readCell(dir, "writing-systems.tsv", "cuneiform", "source_url")).toBe("https://www.wikidata.org/entity/Q401");
        expect(readCell(dir, "writing-systems.tsv", "cuneiform", "retrieved_at")).toBe(RETRIEVED_AT);
        expect(readCell(dir, "writing-systems.tsv", "cuneiform", "confidence")).toBe("0.9");
        expect(readCell(dir, "writing-systems.tsv", "cuneiform", "sources")).toBe(reconcileCitation("Q401"));

        // Curated row: qid filled, but the existing confidence/sources are NOT clobbered (conflict).
        expect(readCell(dir, "writing-systems.tsv", "curated", "wikidata_qid")).toBe("Q999");
        expect(readCell(dir, "writing-systems.tsv", "curated", "confidence")).toBe("0.8");
        expect(readCell(dir, "writing-systems.tsv", "curated", "sources")).toBe("hand");

        // 0–100 scale file → integer confidence for a fresh cell.
        expect(readCell(dir, "archaeological-sites.tsv", "carthage-site", "wikidata_qid")).toBe("Q6343");
        expect(readCell(dir, "archaeological-sites.tsv", "carthage-site", "source_url")).toBe("https://www.wikidata.org/entity/Q6343");
        expect(readCell(dir, "archaeological-sites.tsv", "carthage-site", "confidence")).toBe("90");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });
});
