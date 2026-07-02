import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const LEXICONS_DIR = path.join(import.meta.dirname, "..", "lexicons");

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

describe("culture-profiles.tsv", () => {
  const text = fs.readFileSync(path.join(LEXICONS_DIR, "culture-profiles.tsv"), "utf-8");
  const { header, rows } = parseTsv(text);

  const requiredColumns = [
    "id", "name", "alternate_names", "civilization_id",
    "archaeological_culture_id", "time_period_start", "time_period_end",
    "region", "summary_description", "social_organization", "subsistence_type",
    "urbanism_level", "population_estimate", "technology_level",
    "associated_language_ids", "associated_religion_ids",
    "associated_writing_system_ids", "associated_art_tradition_ids",
    "associated_music_tradition_ids", "associated_cuisine_id",
    "associated_architectural_style_ids", "associated_literary_tradition_ids",
    "notable_settlements", "image_gallery_tags", "sources",
  ];

  it("has all required columns", () => {
    for (const col of requiredColumns) {
      expect(header).toContain(col);
    }
  });

  it("has 100+ culture profile entries", () => {
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  it("has all unique IDs", () => {
    const idIdx = header.indexOf("id");
    const ids = rows.map((r) => r[idIdx]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty IDs or names", () => {
    const idIdx = header.indexOf("id");
    const nameIdx = header.indexOf("name");
    for (const row of rows) {
      expect(row[idIdx]?.trim()).not.toBe("");
      expect(row[nameIdx]?.trim()).not.toBe("");
    }
  });

  it("has valid time periods", () => {
    const startIdx = header.indexOf("time_period_start");
    const endIdx = header.indexOf("time_period_end");
    for (const row of rows) {
      const start = parseInt(row[startIdx], 10);
      expect(isNaN(start)).toBe(false);
      if (row[endIdx] && row[endIdx].trim() !== "" && row[endIdx] !== "null") {
        const end = parseInt(row[endIdx], 10);
        expect(isNaN(end)).toBe(false);
        expect(end).toBeGreaterThanOrEqual(start);
      }
    }
  });

  it("has valid enum values for social_organization", () => {
    const idx = header.indexOf("social_organization");
    const valid = new Set(["egalitarian", "chiefdom", "state", "empire"]);
    for (const row of rows) {
      if (row[idx]?.trim()) expect(valid).toContain(row[idx]);
    }
  });

  it("has valid enum values for subsistence_type", () => {
    const idx = header.indexOf("subsistence_type");
    const valid = new Set(["hunter-gatherer", "pastoral", "agricultural", "maritime", "mixed"]);
    for (const row of rows) {
      if (row[idx]?.trim()) expect(valid).toContain(row[idx]);
    }
  });

  it("has valid enum values for urbanism_level", () => {
    const idx = header.indexOf("urbanism_level");
    const valid = new Set(["nomadic", "village", "town", "city-state", "metropolis"]);
    for (const row of rows) {
      if (row[idx]?.trim()) expect(valid).toContain(row[idx]);
    }
  });

  it("has valid enum values for technology_level", () => {
    const idx = header.indexOf("technology_level");
    const valid = new Set(["stone", "copper", "bronze", "iron", "steel", "industrial"]);
    for (const row of rows) {
      if (row[idx]?.trim()) expect(valid).toContain(row[idx]);
    }
  });

  it("has valid JSON array fields", () => {
    const jsonFields = [
      "alternate_names", "associated_language_ids", "associated_religion_ids",
      "associated_writing_system_ids", "associated_art_tradition_ids",
      "associated_music_tradition_ids", "associated_architectural_style_ids",
      "associated_literary_tradition_ids", "notable_settlements",
      "image_gallery_tags", "sources",
    ];
    for (const row of rows) {
      for (const field of jsonFields) {
        const idx = header.indexOf(field);
        if (idx >= 0 && row[idx]?.trim()) {
          const parsed = JSON.parse(row[idx]);
          expect(Array.isArray(parsed)).toBe(true);
        }
      }
    }
  });

  it("has positive population estimates", () => {
    const idx = header.indexOf("population_estimate");
    for (const row of rows) {
      if (row[idx]?.trim() && row[idx] !== "null") {
        expect(parseInt(row[idx], 10)).toBeGreaterThan(0);
      }
    }
  });

  it("covers 8+ distinct regions", () => {
    const idx = header.indexOf("region");
    const regions = new Set(rows.map((r) => r[idx]));
    expect(regions.size).toBeGreaterThanOrEqual(8);
  });

  it("references valid civilization IDs", () => {
    const civIdIdx = header.indexOf("civilization_id");
    const civText = fs.readFileSync(path.join(LEXICONS_DIR, "civilizations.tsv"), "utf-8");
    const civData = parseTsv(civText);
    const civIds = new Set(civData.rows.map((r) => r[civData.header.indexOf("id")]));
    for (const row of rows) {
      if (row[civIdIdx]?.trim()) {
        expect(civIds).toContain(row[civIdIdx]);
      }
    }
  });

  it("has meaningful descriptions", () => {
    const idx = header.indexOf("summary_description");
    for (const row of rows) {
      expect(row[idx]?.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it("has consistent column count in all rows", () => {
    for (const row of rows) {
      expect(row.length).toBe(header.length);
    }
  });
});
