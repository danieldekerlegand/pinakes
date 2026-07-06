import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  normalizeExtraction,
  resolveContributionEntityType,
  overallConfidence,
  extractionToContributions,
  extractDraftFromText,
  buildExtractionPrompt,
  TextExtractionError,
  type RawTextExtraction,
  type TextExtractorDeps,
  type ExtractedEntity,
} from "./text-extractor";

const FIXTURES = path.join(__dirname, "fixtures", "text-extractor");

function loadRaw(file: string): RawTextExtraction {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf-8")) as RawTextExtraction;
}

/** Fixture-backed LLM deps — no live model call. */
function fixtureDeps(raw: RawTextExtraction): TextExtractorDeps {
  return { async extract() { return raw; } };
}

describe("normalizeExtraction", () => {
  const result = normalizeExtraction(loadRaw("roman-empire-paragraph.json"));

  it("drops entities with a blank name", () => {
    expect(result.entities.map((e) => e.name.value)).toEqual([
      "Roman Empire",
      "Latin",
      "Pompeii",
    ]);
  });

  it("wraps each present field as a 0..1 FieldValue", () => {
    const rome = result.entities[0];
    expect(rome.name).toEqual({ value: "Roman Empire", confidence: 0.95 });
    expect(rome.description?.confidence).toBe(0.8);
    expect(rome.timePeriodStart).toEqual({ value: -27, confidence: 0.85 });
    expect(rome.timePeriodEnd).toEqual({ value: 476, confidence: 0.7 });
    expect(rome.coordinates).toBeUndefined();
  });

  it("keeps coordinates only when both lat/lng are finite", () => {
    const pompeii = result.entities.find((e) => e.name.value === "Pompeii")!;
    expect(pompeii.coordinates).toEqual({
      value: { lat: 40.7497, lng: 14.4869 },
      confidence: 0.92,
    });
  });

  it("falls a missing field confidence back to the name confidence", () => {
    const latin = result.entities.find((e) => e.name.value === "Latin")!;
    // description has no descriptionConfidence in the fixture → inherits 0.9.
    expect(latin.description?.confidence).toBe(0.9);
  });

  it("dedups relationships and drops self edges", () => {
    // Two identical Pompeii→Roman Empire:located-in collapse to one.
    const located = result.relationships.filter((r) => r.type === "located-in");
    expect(located).toHaveLength(1);
    expect(result.relationships).toHaveLength(2); // + French→Latin
  });

  it("clamps out-of-range / missing confidences", () => {
    const raw: RawTextExtraction = {
      entities: [{ name: "X", entityType: "civilization", confidence: 5 }],
      relationships: [],
    };
    expect(normalizeExtraction(raw).entities[0].name.confidence).toBe(1);
  });

  it("flags the whole extraction AI-generated / auto-derived", () => {
    expect(result.aiGenerated).toBe(true);
    expect(result.autoDerived).toBe(true);
  });
});

describe("resolveContributionEntityType", () => {
  it("maps language kinds to language", () => {
    expect(resolveContributionEntityType("language", false)).toBe("language");
    expect(resolveContributionEntityType("Romance dialect", false)).toBe("language");
  });

  it("maps a site to archaeological-site only when coordinates are present", () => {
    expect(resolveContributionEntityType("archaeological site", true)).toBe("archaeological-site");
    // Without coords, archaeological-site would fail validation → civilization.
    expect(resolveContributionEntityType("archaeological site", false)).toBe("civilization");
  });

  it("maps people and trade goods", () => {
    expect(resolveContributionEntityType("historical figure", false)).toBe("historical-figure");
    expect(resolveContributionEntityType("Roman emperor", false)).toBe("historical-figure");
    expect(resolveContributionEntityType("trade good", false)).toBe("trade-good");
  });

  it("keeps religions name-only-safe (civilization), not religion", () => {
    // `religion` requires religionType we can't guarantee.
    expect(resolveContributionEntityType("religion", false)).toBe("civilization");
  });

  it("falls unknown kinds back to civilization", () => {
    expect(resolveContributionEntityType("blorp", false)).toBe("civilization");
  });
});

describe("overallConfidence", () => {
  it("means the present field confidences into 1..99", () => {
    const entity: ExtractedEntity = {
      name: { value: "X", confidence: 0.9 },
      rawType: "civilization",
      description: { value: "d", confidence: 0.7 },
    };
    expect(overallConfidence(entity)).toBe(80);
  });

  it("never returns 100 (always needs-review)", () => {
    const entity: ExtractedEntity = {
      name: { value: "X", confidence: 1 },
      rawType: "civilization",
    };
    expect(overallConfidence(entity)).toBe(99);
  });
});

describe("extractionToContributions", () => {
  const result = normalizeExtraction(loadRaw("roman-empire-paragraph.json"));
  const contribs = extractionToContributions(result, { sourceText: "Ancient Rome…" });

  it("produces one contribution per entity, all flagged ai-extracted", () => {
    expect(contribs).toHaveLength(3);
    for (const c of contribs) {
      expect(c.entityData?.source).toBe("ai-extracted");
      expect(c.entityData?.aiGenerated).toBe(true);
      expect(c.action).toBe("add");
      expect((c.sources ?? [])[0].title).toContain("AI text extraction");
      expect(c.confidence).toBeGreaterThanOrEqual(1);
      expect(c.confidence).toBeLessThan(100);
    }
  });

  it("resolves entity types from the LLM's kind + coordinate presence", () => {
    const types = contribs.map((c) => c.entityType);
    expect(types).toEqual(["civilization", "language", "archaeological-site"]);
  });

  it("carries per-field confidence in entityData", () => {
    const rome = contribs[0];
    expect(rome.entityData?.perFieldConfidence).toMatchObject({ name: 0.95, description: 0.8 });
  });

  it("attaches a relationship to its source entity, else its target", () => {
    const latin = contribs.find((c) => c.entityData?.name === "Latin")!;
    const pompeii = contribs.find((c) => c.entityData?.name === "Pompeii")!;
    // French→Latin: source 'French' not an entity → attaches to target Latin.
    expect((latin.entityData?.relationships as unknown[])).toHaveLength(1);
    // Pompeii→Roman Empire: source Pompeii is an entity → attaches to Pompeii.
    expect((pompeii.entityData?.relationships as unknown[])).toHaveLength(1);
  });
});

describe("extractDraftFromText", () => {
  it("rejects empty text", async () => {
    await expect(extractDraftFromText("   ", fixtureDeps({ entities: [], relationships: [] })))
      .rejects.toBeInstanceOf(TextExtractionError);
  });

  it("runs the injected deps and normalizes", async () => {
    const result = await extractDraftFromText(
      "Rome…",
      fixtureDeps(loadRaw("roman-empire-paragraph.json")),
    );
    expect(result.entities).toHaveLength(3);
  });
});

describe("buildExtractionPrompt", () => {
  it("embeds the source text", () => {
    expect(buildExtractionPrompt("hello world")).toContain("hello world");
  });
});
