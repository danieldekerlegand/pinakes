import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const LEXICONS_DIR = path.join(import.meta.dirname, "..", "data", "source", "lexicons");

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

describe("culture-events.tsv", () => {
  const text = fs.readFileSync(path.join(LEXICONS_DIR, "culture-events.tsv"), "utf-8");
  const { header, rows } = parseTsv(text);

  const requiredColumns = [
    "id",
    "culture_profile_id",
    "year",
    "lane",
    "event_type",
    "title",
    "description",
    "magnitude",
    "sources",
  ];

  it("has all required columns", () => {
    for (const col of requiredColumns) {
      expect(header).toContain(col);
    }
  });

  it("has at least 30 evolution events", () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
  });

  it("has unique event IDs", () => {
    const idIdx = header.indexOf("id");
    const ids = rows.map((r) => r[idIdx]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only canonical lane values", () => {
    const laneIdx = header.indexOf("lane");
    const canonicalLanes = new Set([
      "political",
      "territory",
      "urbanism",
      "technology",
      "religion",
      "language",
      "economy",
    ]);
    for (const row of rows) {
      expect(canonicalLanes.has(row[laneIdx])).toBe(true);
    }
  });

  it("uses only valid magnitude values", () => {
    const magIdx = header.indexOf("magnitude");
    const valid = new Set(["major", "moderate", "minor"]);
    for (const row of rows) {
      expect(valid.has(row[magIdx])).toBe(true);
    }
  });

  it("has integer-parseable years", () => {
    const yearIdx = header.indexOf("year");
    for (const row of rows) {
      const y = parseInt(row[yearIdx], 10);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("references culture profiles that exist", () => {
    const profileText = fs.readFileSync(
      path.join(LEXICONS_DIR, "culture-profiles.tsv"),
      "utf-8"
    );
    const { header: pHeader, rows: pRows } = parseTsv(profileText);
    const pIdIdx = pHeader.indexOf("id");
    const validIds = new Set(pRows.map((r) => r[pIdIdx]));

    const cultureIdx = header.indexOf("culture_profile_id");
    for (const row of rows) {
      expect(validIds.has(row[cultureIdx])).toBe(true);
    }
  });
});
