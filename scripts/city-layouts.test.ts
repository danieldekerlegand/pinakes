import { describe, it, expect } from "vitest";
import { parseTsv, computeColumnStats, auditFile } from "./audit-tsv";
import path from "path";
import fs from "fs";

const LEXICONS_DIR = path.resolve(import.meta.dirname, "..", "lexicons");
const CITY_LAYOUTS_PATH = path.join(LEXICONS_DIR, "city-layouts.tsv");

describe("city-layouts.tsv", () => {
  it("exists and is readable", () => {
    expect(fs.existsSync(CITY_LAYOUTS_PATH)).toBe(true);
  });

  it("parses with correct headers", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    expect(headers).toContain("id");
    expect(headers).toContain("name");
    expect(headers).toContain("civilization_id");
    expect(headers).toContain("layout_type");
    expect(headers).toContain("coordinates");
    expect(headers).toContain("grid_system");
    expect(headers).toContain("districts");
    expect(headers).toContain("street_pattern");
    expect(headers).toContain("water_management");
    expect(headers).toContain("fortifications");
    expect(headers).toContain("public_spaces");
    expect(headers).toContain("residential_zones");
    expect(headers).toContain("sacred_precinct");
    expect(headers).toContain("market_areas");
    expect(headers).toContain("description");
    expect(headers).toContain("associated_languages");
    expect(headers).toContain("sources");
    expect(rows.length).toBeGreaterThanOrEqual(20);
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

  it("all rows have valid coordinates as JSON objects", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const coordIdx = headers.indexOf("coordinates");
    for (const row of rows) {
      const val = row[coordIdx]?.trim();
      if (val) {
        const parsed = JSON.parse(val);
        expect(parsed).toHaveProperty("lat");
        expect(parsed).toHaveProperty("lng");
        expect(typeof parsed.lat).toBe("number");
        expect(typeof parsed.lng).toBe("number");
        expect(parsed.lat).toBeGreaterThanOrEqual(-90);
        expect(parsed.lat).toBeLessThanOrEqual(90);
        expect(parsed.lng).toBeGreaterThanOrEqual(-180);
        expect(parsed.lng).toBeLessThanOrEqual(180);
      }
    }
  });

  it("all rows have valid JSON arrays for list fields", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const arrayFields = [
      "major_axes",
      "districts",
      "water_management",
      "fortifications",
      "public_spaces",
      "residential_zones",
      "sacred_precinct",
      "market_areas",
      "associated_languages",
      "sources",
    ];
    for (const field of arrayFields) {
      const idx = headers.indexOf(field);
      if (idx === -1) continue;
      for (const row of rows) {
        const val = row[idx]?.trim();
        if (val) {
          const parsed = JSON.parse(val);
          expect(Array.isArray(parsed)).toBe(true);
        }
      }
    }
  });

  it("dates are valid integers (negative for BCE)", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const originIdx = headers.indexOf("origin_date");
    const endIdx = headers.indexOf("end_date");
    for (const row of rows) {
      const origin = row[originIdx]?.trim();
      if (origin) {
        expect(Number.isInteger(Number(origin))).toBe(true);
      }
      const end = row[endIdx]?.trim();
      if (end) {
        expect(Number.isInteger(Number(end))).toBe(true);
      }
    }
  });

  it("covers diverse layout types", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const typeIdx = headers.indexOf("layout_type");
    const types = new Set(rows.map((r) => r[typeIdx]));
    expect(types.size).toBeGreaterThanOrEqual(10);
    expect(types).toContain("orthogonal-grid");
    expect(types).toContain("organic-radial");
  });

  it("covers multiple geographic regions", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const coordIdx = headers.indexOf("coordinates");
    let hasNegLat = false;
    let hasPosLat = false;
    let hasNegLng = false;
    let hasPosLng = false;
    for (const row of rows) {
      const coords = JSON.parse(row[coordIdx]);
      if (coords.lat < 0) hasNegLat = true;
      if (coords.lat > 0) hasPosLat = true;
      if (coords.lng < 0) hasNegLng = true;
      if (coords.lng > 0) hasPosLng = true;
    }
    expect(hasNegLat).toBe(true);
    expect(hasPosLat).toBe(true);
    expect(hasNegLng).toBe(true);
    expect(hasPosLng).toBe(true);
  });

  it("has no unexpected sparse columns", () => {
    const audit = auditFile(CITY_LAYOUTS_PATH);
    // settlement_id is intentionally sparse — not all layouts link to a settlement in settlements.tsv
    const unexpected = audit.sparseColumns.filter((c) => c !== "settlement_id");
    expect(unexpected).toEqual([]);
  });

  it("descriptions are substantive (>100 chars)", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const descIdx = headers.indexOf("description");
    for (const row of rows) {
      const desc = row[descIdx]?.trim();
      expect(desc.length).toBeGreaterThan(100);
    }
  });

  it("every row has at least one associated language", () => {
    const { headers, rows } = parseTsv(CITY_LAYOUTS_PATH);
    const langIdx = headers.indexOf("associated_languages");
    for (const row of rows) {
      const langs = JSON.parse(row[langIdx]);
      expect(langs.length).toBeGreaterThanOrEqual(1);
    }
  });
});
