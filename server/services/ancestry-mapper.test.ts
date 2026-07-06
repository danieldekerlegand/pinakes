import { describe, it, expect } from "vitest";

import {
  mapHaplogroupsToAncestry,
  ANCESTRY_CAVEATS,
  type AncestryMapperData,
} from "./genetic-linguistic-correlation";

const DATA: AncestryMapperData = {
  haplogroups: [
    {
      id: "r1b",
      name: "R1b",
      geographicOrigin: "Western Europe",
      timeOrigin: -20000,
      associatedLanguageFamilyIds: ["italo-celtic", "germanic"],
      associatedCivilizationIds: ["celts"],
    },
    {
      id: "r1a",
      name: "R1a",
      geographicOrigin: "Eastern Europe",
      timeOrigin: -22000,
      associatedLanguageFamilyIds: ["germanic"], // shared with r1b → higher confidence
      associatedCivilizationIds: [],
    },
    {
      id: "n",
      name: "N",
      geographicOrigin: "Siberia",
      timeOrigin: -18000,
      associatedLanguageFamilyIds: ["uralic"],
      associatedCivilizationIds: [],
    },
  ],
  families: [
    { id: "italo-celtic", name: "Italo-Celtic", region: "Western Europe" },
    { id: "germanic", name: "Germanic", region: "Northern Europe" },
    { id: "uralic", name: "Uralic", region: "Northeast Europe" },
  ],
  languages: [
    { id: "gaulish", name: "Gaulish", familyId: "italo-celtic" },
    { id: "latin", name: "Latin", familyId: "italo-celtic" },
    { id: "old-norse", name: "Old Norse", familyId: "germanic" },
    { id: "finnish", name: "Finnish", familyId: "uralic" },
  ],
  civilizations: [{ id: "celts", name: "Celts" }],
  cuisines: [
    { id: "gallic-cuisine", name: "Gallic Cuisine", region: "Gaul", associatedLanguageIds: ["gaulish"] },
    { id: "unrelated", name: "Andean Cuisine", region: "Andes", associatedLanguageIds: ["quechua"] },
  ],
};

describe("mapHaplogroupsToAncestry", () => {
  it("maps haplogroups to language families, cultures, and cuisines", () => {
    const result = mapHaplogroupsToAncestry(["r1b"], DATA);
    expect(result.matchedHaplogroups.map((h) => h.id)).toEqual(["r1b"]);

    const families = result.spoke.map((s) => s.familyId).sort();
    expect(families).toEqual(["germanic", "italo-celtic"]);

    // "Lived among" comes from associatedCivilizationIds.
    expect(result.livedAmong.map((c) => c.civilizationId)).toEqual(["celts"]);

    // Cuisine is reached via italo-celtic → gaulish → gallic-cuisine (indirect).
    expect(result.ate.map((c) => c.cuisineId)).toEqual(["gallic-cuisine"]);

    // Sample languages come from the family's languages.
    const italoCeltic = result.spoke.find((s) => s.familyId === "italo-celtic");
    expect(italoCeltic?.sampleLanguages).toEqual(expect.arrayContaining(["Gaulish", "Latin"]));

    // Caveats are always present.
    expect(result.caveats).toEqual(ANCESTRY_CAVEATS);
  });

  it("raises confidence for a family supported by multiple haplogroups", () => {
    const result = mapHaplogroupsToAncestry(["r1b", "r1a"], DATA);
    const germanic = result.spoke.find((s) => s.familyId === "germanic");
    const italoCeltic = result.spoke.find((s) => s.familyId === "italo-celtic");
    // Germanic is backed by both r1b and r1a; italo-celtic by r1b alone.
    expect(germanic?.viaHaplogroups).toEqual(["R1a", "R1b"]);
    expect(germanic!.confidence).toBeGreaterThan(italoCeltic!.confidence);
  });

  it("is case-insensitive and reports unmatched ids", () => {
    const result = mapHaplogroupsToAncestry(["R1B", "unknown-hg"], DATA);
    expect(result.matchedHaplogroups.map((h) => h.id)).toEqual(["r1b"]);
    expect(result.unmatchedHaplogroupIds).toEqual(["unknown-hg"]);
  });

  it("surfaces a notable genetics/linguistics divergence", () => {
    // N + uralic is a known divergence in NOTABLE_DIVERGENCES.
    const result = mapHaplogroupsToAncestry(["n"], DATA);
    expect(result.divergences.length).toBeGreaterThan(0);
    expect(result.divergences[0].languageFamilyName).toBe("Uralic");
  });

  it("returns an empty, caveated result when nothing matches", () => {
    const result = mapHaplogroupsToAncestry(["nope"], DATA);
    expect(result.matchedHaplogroups).toHaveLength(0);
    expect(result.spoke).toHaveLength(0);
    expect(result.summary).toContain("no cultural associations");
    expect(result.caveats).toEqual(ANCESTRY_CAVEATS);
  });
});
