import { describe, it, expect } from "vitest";
import { parseTsv, auditFile } from "./audit-tsv";
import path from "path";
import fs from "fs";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "..", "data", "source", "lexicons");
const CITY_LAYOUTS_PATH = path.join(LEXICONS_DIR, "city-layouts.tsv");

/**
 * The columns `TsvStorage.loadCityLayouts` reads, in file order. This list IS the
 * contract — the loader projects each one onto a `CityLayout` field, so a rename or
 * a drop here silently blanks that field rather than failing. Keep the two in sync.
 */
const EXPECTED_HEADERS = [
  "id",
  "settlement_id",
  "culture_profile_id",
  "layout_type",
  "key_features",
  "street_pattern",
  "water_management",
  "fortification_type",
  "estimated_area_hectares",
  "description",
  "reconstruction_notes",
  "sources",
];

/** Columns the loader splits on "|" rather than reading as a scalar. */
const PIPE_LIST_FIELDS = ["key_features", "water_management"];

/** The loader's sentinel for an unmeasurable footprint (→ `estimatedAreaHectares: null`). */
const AREA_UNDETERMINED = "undetermined";

describe("city-layouts.tsv", () => {
  it("exists and is readable", () => {
    expect(fs.existsSync(CITY_LAYOUTS_PATH)).toBe(true);
  });

  it("header matches the loader's column contract exactly", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    expect(headers).toEqual(EXPECTED_HEADERS);
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  it("has unique IDs", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const idIdx = headers.indexOf("id");
    const ids = rows.map((r) => r[idIdx]);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all IDs follow cl-NNN pattern", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const idIdx = headers.indexOf("id");
    for (const row of rows) {
      expect(row[idIdx]).toMatch(/^cl-\d{3}$/);
    }
  });

  it("list fields are non-empty pipe-separated values", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    for (const field of PIPE_LIST_FIELDS) {
      const idx = headers.indexOf(field);
      expect(idx).toBeGreaterThanOrEqual(0);
      for (const row of rows) {
        const parts = (row[idx] ?? "")
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);
        expect(parts.length).toBeGreaterThanOrEqual(1);
        // A JSON-array cell would survive the split intact — catch that regression,
        // since the loader would then hand the UI one bogus "[\"a\",\"b\"]" entry.
        for (const part of parts) {
          expect(part.startsWith("[")).toBe(false);
        }
      }
    }
  });

  it("estimated_area_hectares is a positive number or the undetermined sentinel", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const areaIdx = headers.indexOf("estimated_area_hectares");
    for (const row of rows) {
      const raw = row[areaIdx]?.trim();
      expect(raw).toBeTruthy();
      if (raw === AREA_UNDETERMINED) continue;
      const value = Number(raw);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("covers diverse layout types", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const typeIdx = headers.indexOf("layout_type");
    const types = new Set(rows.map((r) => r[typeIdx]));
    // Floor at the current breadth — this should ratchet up as the corpus grows.
    expect(types.size).toBeGreaterThanOrEqual(6);
    expect(types).toContain("grid");
    expect(types).toContain("organic");
  });

  it("every row is attributed to a settlement and a culture profile", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const settlementIdx = headers.indexOf("settlement_id");
    const cultureIdx = headers.indexOf("culture_profile_id");
    for (const row of rows) {
      expect(row[settlementIdx]?.trim()).toBeTruthy();
      expect(row[cultureIdx]?.trim()).toBeTruthy();
    }
  });

  it("has no unexpected sparse columns", () => {
    const audit = auditFile(CITY_LAYOUTS_PATH);
    expect(audit.sparseColumns).toEqual([]);
  });

  it("descriptions are substantive (>100 chars)", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const descIdx = headers.indexOf("description");
    for (const row of rows) {
      const desc = row[descIdx]?.trim();
      expect(desc.length).toBeGreaterThan(100);
    }
  });

  it("every row cites at least one source", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const sourcesIdx = headers.indexOf("sources");
    for (const row of rows) {
      expect(row[sourcesIdx]?.trim()).toBeTruthy();
    }
  });
});
