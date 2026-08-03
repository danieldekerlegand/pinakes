import { describe, it, expect } from "vitest";
import {
  Artifact,
  clampZoom,
  describeProvenance,
  findComparableArtifacts,
  formatOriginDate,
  getArtifactKindLabel,
  getCategoryColor,
  normalizeArtTradition,
  normalizeMaterialCulture,
  normalizeMusicalInstrument,
  scoreComparable,
} from "./artifact-viewer-utils";

function artifact(overrides: Partial<Artifact> & { id: string }): Artifact {
  return {
    kind: "material_culture",
    name: "Artifact",
    ...overrides,
  };
}

describe("formatOriginDate", () => {
  it("formats BCE dates", () => {
    expect(formatOriginDate(-2800)).toBe("2800 BCE");
  });

  it("formats CE dates", () => {
    expect(formatOriginDate(1500)).toBe("1500 CE");
  });

  it("returns em-dash for null or NaN", () => {
    expect(formatOriginDate(undefined)).toBe("—");
    expect(formatOriginDate(null)).toBe("—");
    expect(formatOriginDate(Number.NaN)).toBe("—");
  });

  it("handles year zero", () => {
    expect(formatOriginDate(0)).toBe("1 BCE/CE");
  });
});

describe("clampZoom", () => {
  it("clamps below minimum", () => {
    expect(clampZoom(0.2, 1, 8)).toBe(1);
  });

  it("clamps above maximum", () => {
    expect(clampZoom(12, 1, 8)).toBe(8);
  });

  it("returns min for NaN input", () => {
    expect(clampZoom(Number.NaN, 1, 8)).toBe(1);
  });

  it("passes through values in range", () => {
    expect(clampZoom(3.5, 1, 8)).toBe(3.5);
  });
});

describe("getCategoryColor", () => {
  it("returns a color for known categories", () => {
    expect(getCategoryColor("pottery")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getCategoryColor("Sculpture")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getCategoryColor("string")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("falls back to a default for unknown categories", () => {
    expect(getCategoryColor(undefined)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getCategoryColor("zzz-unknown")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("matches partial keywords in compound categories", () => {
    expect(getCategoryColor("ancient pottery")).toBe(
      getCategoryColor("pottery"),
    );
  });
});

describe("getArtifactKindLabel", () => {
  it("labels all kinds", () => {
    expect(getArtifactKindLabel("material_culture")).toBe("Material Culture");
    expect(getArtifactKindLabel("art_tradition")).toBe("Art Tradition");
    expect(getArtifactKindLabel("musical_instrument")).toBe(
      "Musical Instrument",
    );
  });
});

describe("normalizeMaterialCulture", () => {
  it("parses coordinate arrays and material lists", () => {
    const result = normalizeMaterialCulture({
      id: "mc_001",
      name: "Bell Beaker pottery",
      category: "pottery",
      origin_date: -2800,
      origin_coordinates: [37.0, -5.0],
      description: "Bell-shaped vessels",
      associated_languages: "pre-Celtic, pre-Germanic",
      significance: "Archaeological horizon marker",
      materials: ["clay", "slip"],
      sources: ["Archaeology Journal"],
    });

    expect(result.id).toBe("mc_001");
    expect(result.kind).toBe("material_culture");
    expect(result.originDate).toBe(-2800);
    expect(result.originCoordinates).toEqual({ lat: 37, lng: -5 });
    expect(result.materials).toEqual(["clay", "slip"]);
    expect(result.associatedLanguageIds).toEqual([
      "pre-Celtic",
      "pre-Germanic",
    ]);
    expect(result.culturalSignificance).toBe("Archaeological horizon marker");
    expect(result.sources).toEqual(["Archaeology Journal"]);
  });

  it("parses JSON-formatted string materials", () => {
    const result = normalizeMaterialCulture({
      id: "mc_test",
      name: "Test",
      materials: '["bronze","tin"]',
    });
    expect(result.materials).toEqual(["bronze", "tin"]);
  });

  it("returns empty arrays for missing list fields", () => {
    const result = normalizeMaterialCulture({ id: "mc", name: "Test" });
    expect(result.materials).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.sources).toEqual([]);
  });
});

describe("normalizeArtTradition", () => {
  it("extracts origin coordinates from lat/lng objects", () => {
    const result = normalizeArtTradition({
      id: "art-001",
      name: "Egyptian Monumental",
      category: "architecture",
      style_period: "Ancient Egyptian",
      origin_date: -3100,
      origin_coordinates: { lat: 29.98, lng: 31.13 },
      description: "Massive stone architecture",
      associated_civilizations: "Egyptian",
      key_features: ["colossal scale", "hieroglyphic decoration"],
      notable_examples: ["Great Pyramid"],
      sources: ["Art Historians Reference"],
    });

    expect(result.kind).toBe("art_tradition");
    expect(result.originCoordinates).toEqual({ lat: 29.98, lng: 31.13 });
    expect(result.materials).toEqual([
      "colossal scale",
      "hieroglyphic decoration",
    ]);
    expect(result.associatedCultureIds).toEqual(["Egyptian"]);
    expect(result.tags).toEqual(["Great Pyramid"]);
    expect(result.culturalSignificance).toContain("Ancient Egyptian");
  });
});

describe("normalizeMusicalInstrument", () => {
  it("captures native name, region and technique", () => {
    const result = normalizeMusicalInstrument({
      id: "sitar",
      name: "Sitar",
      native_name: "सितार",
      instrument_family: "string",
      origin_region: "South Asia",
      coordinates: { lat: 28.61, lng: 77.21 },
      time_origin: 1700,
      construction_materials: ["gourd", "teak"],
      playing_technique: "plucked",
      associated_tradition_ids: ["indian-classical"],
      associated_language_ids: ["hindi"],
    });

    expect(result.kind).toBe("musical_instrument");
    expect(result.nativeName).toBe("सितार");
    expect(result.originRegion).toBe("South Asia");
    expect(result.constructionTechnique).toBe("plucked");
    expect(result.originDate).toBe(1700);
    expect(result.associatedCultureIds).toEqual(["indian-classical"]);
  });

  it("handles string-encoded coordinates", () => {
    const result = normalizeMusicalInstrument({
      id: "tabla",
      name: "Tabla",
      coordinates: '{"lat":28.61,"lng":77.21}',
    });
    expect(result.originCoordinates).toEqual({ lat: 28.61, lng: 77.21 });
  });
});

describe("scoreComparable", () => {
  it("returns negative infinity for the same artifact", () => {
    const a = artifact({ id: "a" });
    expect(scoreComparable(a, a)).toBe(-Infinity);
  });

  it("scores matching categories higher than just matching kinds", () => {
    const ref = artifact({ id: "ref", category: "pottery" });
    const sameCat = artifact({ id: "a", category: "pottery" });
    const sameKind = artifact({ id: "b", category: "sculpture" });
    expect(scoreComparable(ref, sameCat)).toBeGreaterThan(
      scoreComparable(ref, sameKind),
    );
  });

  it("boosts matches sharing materials", () => {
    const ref = artifact({
      id: "ref",
      category: "pottery",
      materials: ["clay", "slip"],
    });
    const overlap = artifact({
      id: "a",
      category: "pottery",
      materials: ["clay"],
    });
    const noOverlap = artifact({
      id: "b",
      category: "pottery",
      materials: ["bronze"],
    });
    expect(scoreComparable(ref, overlap)).toBeGreaterThan(
      scoreComparable(ref, noOverlap),
    );
  });

  it("demotes same-culture matches when crossCultural is true", () => {
    const ref = artifact({
      id: "ref",
      category: "pottery",
      associatedCultureIds: ["egypt"],
    });
    const same = artifact({
      id: "a",
      category: "pottery",
      associatedCultureIds: ["egypt"],
    });
    const different = artifact({
      id: "b",
      category: "pottery",
      associatedCultureIds: ["rome"],
    });

    const sameScore = scoreComparable(ref, same, true);
    const diffScore = scoreComparable(ref, different, true);
    expect(diffScore).toBeGreaterThan(sameScore);
  });

  it("rewards temporal proximity", () => {
    const ref = artifact({ id: "ref", category: "pottery", originDate: -2000 });
    const near = artifact({ id: "a", category: "pottery", originDate: -1900 });
    const far = artifact({ id: "b", category: "pottery", originDate: 1900 });
    expect(scoreComparable(ref, near)).toBeGreaterThan(
      scoreComparable(ref, far),
    );
  });
});

describe("findComparableArtifacts", () => {
  const pool: Artifact[] = [
    artifact({
      id: "pot-eg",
      category: "pottery",
      materials: ["clay"],
      associatedCultureIds: ["egypt"],
    }),
    artifact({
      id: "pot-rome",
      category: "pottery",
      materials: ["clay"],
      associatedCultureIds: ["rome"],
    }),
    artifact({
      id: "sculpt-greek",
      category: "sculpture",
      materials: ["marble"],
      associatedCultureIds: ["greek"],
    }),
    artifact({ id: "tool", category: "tool", materials: ["bronze"] }),
  ];

  it("excludes the reference artifact itself", () => {
    const ref = pool[0];
    const results = findComparableArtifacts(ref, pool);
    expect(results.map((r) => r.id)).not.toContain(ref.id);
  });

  it("limits the result count", () => {
    const ref = artifact({ id: "ref", category: "pottery" });
    const results = findComparableArtifacts(ref, pool, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("prefers cross-cultural matches when requested", () => {
    const ref = pool[0];
    const results = findComparableArtifacts(ref, pool, {
      limit: 1,
      crossCultural: true,
    });
    expect(results[0]?.id).toBe("pot-rome");
  });

  it("returns an empty array when pool has no other artifacts", () => {
    const ref = artifact({ id: "solo" });
    expect(findComparableArtifacts(ref, [ref])).toEqual([]);
  });

  it("handles zero limit gracefully", () => {
    const ref = artifact({ id: "ref", category: "pottery" });
    expect(findComparableArtifacts(ref, pool, { limit: 0 })).toEqual([]);
  });
});

describe("describeProvenance", () => {
  it("combines site and current location", () => {
    const a = artifact({
      id: "a",
      provenance: {
        discoverySite: "Pompeii",
        currentLocation: "Naples Museum",
      },
    });
    const description = describeProvenance(a);
    expect(description).toContain("Pompeii");
    expect(description).toContain("Naples Museum");
  });

  it("falls back to origin region when no provenance site", () => {
    const a = artifact({
      id: "a",
      originRegion: "Mesopotamia",
      provenance: {},
    });
    expect(describeProvenance(a)).toContain("Mesopotamia");
  });

  it("returns an empty string when nothing is known", () => {
    const a = artifact({ id: "a" });
    expect(describeProvenance(a)).toBe("");
  });
});
