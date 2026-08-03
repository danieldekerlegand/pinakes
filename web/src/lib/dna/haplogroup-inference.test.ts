import { describe, it, expect } from "vitest";

import { parseDnaFile } from "./dna-parser";
import { inferHaplogroups, definingRsid } from "./haplogroup-inference";

/** Build a 23andMe-style file where the given rsids are called with a Y genotype. */
function yFile(calls: Record<string, string>): string {
  const rows = ["# rsid\tchromosome\tposition\tgenotype"];
  let pos = 1000;
  for (const [rsid, genotype] of Object.entries(calls)) {
    rows.push(`${rsid}\tY\t${pos}\t${genotype}`);
    pos += 1;
  }
  return rows.join("\n");
}

describe("inferHaplogroups", () => {
  it("assigns the most specific haplogroup when a full lineage is derived", () => {
    // R1b lineage: CT (M168) → F (M89) → K (M9) → P (M45) → R (M207) → R1b (M269).
    const file = yFile({
      [definingRsid("ct")!]: "TT",
      [definingRsid("f")!]: "TT",
      [definingRsid("k")!]: "CC",
      [definingRsid("p")!]: "AA",
      [definingRsid("r")!]: "GG",
      [definingRsid("r1b")!]: "CC",
    });
    const result = inferHaplogroups(parseDnaFile(file));
    expect(result.hasYData).toBe(true);
    expect(result.yHaplogroup?.haplogroupId).toBe("r1b");
    // Full path derived → confidence 1.
    expect(result.yHaplogroup?.confidence).toBe(1);
    expect(result.yHaplogroup?.derivedMarkers).toContain("M269");
  });

  it("lowers confidence when only part of the lineage path is confirmed", () => {
    // Only the R1b defining marker is derived; ancestral markers absent.
    const file = yFile({ [definingRsid("r1b")!]: "CC" });
    const result = inferHaplogroups(parseDnaFile(file));
    expect(result.yHaplogroup?.haplogroupId).toBe("r1b");
    expect(result.yHaplogroup?.confidence).toBeLessThan(1);
    expect(result.yHaplogroup?.confidence).toBeGreaterThan(0);
  });

  it("picks the deepest branch among several derived markers", () => {
    // Both O (M175) and its subclade O2 (M95) derived → O2 wins.
    const file = yFile({
      [definingRsid("ct")!]: "TT",
      [definingRsid("f")!]: "TT",
      [definingRsid("k")!]: "CC",
      [definingRsid("o")!]: "CC",
      [definingRsid("o2")!]: "TT",
    });
    const result = inferHaplogroups(parseDnaFile(file));
    expect(result.yHaplogroup?.haplogroupId).toBe("o2");
  });

  it("reports no Y data for a sample without Y-chromosome calls", () => {
    const parsed = parseDnaFile("# rsid\tchromosome\tposition\tgenotype\nrs1\t1\t100\tAA");
    const result = inferHaplogroups(parsed);
    expect(result.hasYData).toBe(false);
    expect(result.yHaplogroup).toBeNull();
  });

  it("returns null haplogroup when Y data exists but no defining marker is derived", () => {
    // A Y SNP that is not one of our defining markers → unassignable.
    const parsed = parseDnaFile("# rsid\tchromosome\tposition\tgenotype\nrsUnknownY\tY\t100\tAA");
    const result = inferHaplogroups(parsed);
    expect(result.hasYData).toBe(true);
    expect(result.yHaplogroup).toBeNull();
  });
});
