import { describe, it, expect } from "vitest";
import {
  DATALOG_PRESETS,
  CYPHER_PRESETS,
  datalogToTable,
  cypherToTable,
} from "./research-console";

describe("research-console presets", () => {
  it("ships the three required datalog presets", () => {
    const labels = DATALOG_PRESETS.map((p) => p.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "contemporary_with/2",
        "same_region/2",
        "descends_from (transitive)",
      ]),
    );
  });

  it("datalog presets define a main/0 goal", () => {
    for (const preset of DATALOG_PRESETS) {
      expect(preset.query).toMatch(/main\s*:-/);
    }
  });

  it("cypher presets are read-only (no write clauses)", () => {
    const write = /\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP)\b/i;
    for (const preset of CYPHER_PRESETS) {
      expect(preset.query).not.toMatch(write);
      expect(preset.query).toMatch(/\bLIMIT\b/i);
    }
  });
});

describe("datalogToTable", () => {
  it("labels a single-column answer 'Result'", () => {
    const table = datalogToTable({
      ran: true,
      rows: [["cs:language:pie"], ["cs:language:proto-celtic"]],
      problems: [],
      error: null,
      reason: null,
    });
    expect(table.columns).toEqual(["Result"]);
    expect(table.rows).toHaveLength(2);
  });

  it("synthesises Column N headers for wider answers", () => {
    const table = datalogToTable({
      ran: true,
      rows: [["a", "b", "c"]],
      problems: [],
      error: null,
      reason: null,
    });
    expect(table.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
  });

  it("handles an empty answer", () => {
    const table = datalogToTable({
      ran: true,
      rows: [],
      problems: [],
      error: null,
      reason: null,
    });
    expect(table.columns).toEqual(["Result"]);
    expect(table.rows).toEqual([]);
  });
});

describe("cypherToTable", () => {
  it("passes through the named columns and rows", () => {
    const table = cypherToTable({
      columns: ["descendant", "ancestor"],
      rows: [["Gaulish", "PIE"]],
    });
    expect(table.columns).toEqual(["descendant", "ancestor"]);
    expect(table.rows).toEqual([["Gaulish", "PIE"]]);
  });
});
