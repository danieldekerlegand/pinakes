import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  parseSourceUrl,
  parseWikidataYear,
  draftFromWikidataEntity,
  extractDraftFromUrl,
  draftToContribution,
  overallConfidence,
  UrlExtractionError,
  type WikidataEntity,
  type UrlExtractorDeps,
  type WikipediaPage,
} from "./url-extractor";

const FIXTURES = path.join(__dirname, "fixtures", "url-extractor");

function loadEntity(qid: string): WikidataEntity {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `wikidata-${qid}.json`), "utf-8"),
  ) as { entities: Record<string, WikidataEntity> };
  return raw.entities[qid];
}

function loadWikipedia(file: string): { title?: string; extract?: string; wikibase_item?: string; coordinates?: { lat: number; lon: number } } {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf-8"));
}

/** Recorded-fixture-backed deps — no live network. */
function fixtureDeps(overrides: Partial<UrlExtractorDeps> = {}): UrlExtractorDeps {
  return {
    async fetchWikidataEntity(qid: string): Promise<WikidataEntity> {
      const file = path.join(FIXTURES, `wikidata-${qid}.json`);
      if (!fs.existsSync(file)) throw new UrlExtractionError(`no fixture for ${qid}`);
      return loadEntity(qid);
    },
    async fetchWikipediaPage(lang: string, title: string): Promise<WikipediaPage> {
      const slug = title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
      const data = loadWikipedia(`wikipedia-summary-${slug}.json`);
      return {
        title: data.title ?? title,
        lang,
        qid: data.wikibase_item,
        extract: data.extract,
        coordinates: data.coordinates
          ? { lat: data.coordinates.lat, lng: data.coordinates.lon }
          : undefined,
      };
    },
    ...overrides,
  };
}

describe("parseSourceUrl", () => {
  it("classifies a /wiki/Qxx Wikidata URL", () => {
    expect(parseSourceUrl("https://www.wikidata.org/wiki/Q2277")).toEqual({
      kind: "wikidata",
      qid: "Q2277",
    });
  });

  it("classifies an /entity/Qxx and Special:EntityData URL", () => {
    expect(parseSourceUrl("http://www.wikidata.org/entity/Q42").qid).toBe("Q42");
    expect(
      parseSourceUrl("https://www.wikidata.org/wiki/Special:EntityData/Q99.json").qid,
    ).toBe("Q99");
  });

  it("classifies a Wikipedia article URL with lang + decoded title", () => {
    expect(parseSourceUrl("https://en.wikipedia.org/wiki/Roman_Empire")).toEqual({
      kind: "wikipedia",
      lang: "en",
      title: "Roman Empire",
    });
    expect(parseSourceUrl("https://de.wikipedia.org/wiki/R%C3%B6misches_Reich")).toEqual({
      kind: "wikipedia",
      lang: "de",
      title: "Römisches Reich",
    });
  });

  it("rejects a non-URL, empty, or unsupported host", () => {
    expect(() => parseSourceUrl("")).toThrow(UrlExtractionError);
    expect(() => parseSourceUrl("not a url")).toThrow(UrlExtractionError);
    expect(() => parseSourceUrl("https://example.com/wiki/Q1")).toThrow(UrlExtractionError);
    expect(() => parseSourceUrl("https://www.wikidata.org/wiki/Main_Page")).toThrow(
      UrlExtractionError,
    );
  });
});

describe("parseWikidataYear", () => {
  it("parses CE and BCE years and rejects junk", () => {
    expect(parseWikidataYear("+0476-01-01T00:00:00Z")).toBe(476);
    expect(parseWikidataYear("-0027-01-01T00:00:00Z")).toBe(-27);
    expect(parseWikidataYear(undefined)).toBeNull();
    expect(parseWikidataYear("not-a-time")).toBeNull();
  });
});

describe("draftFromWikidataEntity", () => {
  const draft = draftFromWikidataEntity(loadEntity("Q2277"), {
    kind: "wikidata",
    sourceUrl: "https://www.wikidata.org/wiki/Q2277",
  });

  it("extracts name, description, coordinates and a signed date range", () => {
    expect(draft.name.value).toBe("Roman Empire");
    expect(draft.name.confidence).toBeGreaterThan(0.9);
    expect(draft.description?.value).toMatch(/empire/i);
    expect(draft.coordinates?.value).toEqual({ lat: 41.9, lng: 12.5 });
    expect(draft.timePeriodStart?.value).toBe(-27);
    expect(draft.timePeriodEnd?.value).toBe(476);
  });

  it("surfaces mapped relationships with property + target, deduped", () => {
    const types = draft.relationships.map((r) => r.type);
    expect(types).toContain("instance-of");
    expect(types).toContain("influenced-by");
    expect(types).toContain("part-of");
    const influenced = draft.relationships.find((r) => r.type === "influenced-by");
    expect(influenced?.targetQid).toBe("Q1747689");
    // P737 and P361 both point at Q1747689 but are distinct (property, target) pairs.
    const q1747689 = draft.relationships.filter((r) => r.targetQid === "Q1747689");
    expect(q1747689).toHaveLength(2);
  });

  it("always flags the draft as AI/auto-derived", () => {
    expect(draft.aiGenerated).toBe(true);
    expect(draft.autoDerived).toBe(true);
  });
});

describe("extractDraftFromUrl", () => {
  it("resolves a Wikidata URL to a draft", async () => {
    const draft = await extractDraftFromUrl("https://www.wikidata.org/wiki/Q2277", fixtureDeps());
    expect(draft.kind).toBe("wikidata");
    expect(draft.name.value).toBe("Roman Empire");
    expect(draft.wikidataQid).toBe("Q2277");
  });

  it("resolves a Wikipedia URL via its Wikidata item, preferring the summary extract", async () => {
    const draft = await extractDraftFromUrl(
      "https://en.wikipedia.org/wiki/Roman_Empire",
      fixtureDeps(),
    );
    expect(draft.kind).toBe("wikipedia");
    expect(draft.wikidataQid).toBe("Q2277");
    // Description comes from the Wikipedia summary override, not the WD description.
    expect(draft.description?.value).toMatch(/post-Republican/);
  });

  it("falls back to a summary-only draft when the article has no Wikidata item", async () => {
    const draft = await extractDraftFromUrl(
      "https://en.wikipedia.org/wiki/Some_Obscure_Village",
      fixtureDeps(),
    );
    expect(draft.kind).toBe("wikipedia");
    expect(draft.wikidataQid).toBeUndefined();
    expect(draft.name.value).toBe("Some Obscure Village");
    expect(draft.coordinates?.value).toEqual({ lat: 12.34, lng: 56.78 });
    expect(draft.relationships).toHaveLength(0);
  });

  it("rejects an unsupported URL", async () => {
    await expect(extractDraftFromUrl("https://example.com/x", fixtureDeps())).rejects.toBeInstanceOf(
      UrlExtractionError,
    );
  });
});

describe("draftToContribution", () => {
  const draft = draftFromWikidataEntity(loadEntity("Q2277"), {
    kind: "wikidata",
    sourceUrl: "https://www.wikidata.org/wiki/Q2277",
  });

  it("produces an add-contribution flagged auto-derived with per-field confidence", () => {
    const contrib = draftToContribution(draft);
    expect(contrib.entityType).toBe("civilization");
    expect(contrib.action).toBe("add");
    expect((contrib.entityData as any).source).toBe("auto-derived");
    expect((contrib.entityData as any).aiGenerated).toBe(true);
    expect((contrib.entityData as any).name).toBe("Roman Empire");
    expect((contrib.entityData as any).perFieldConfidence.name).toBeGreaterThan(0.9);
    expect(contrib.sources?.[0].url).toBe("https://www.wikidata.org/wiki/Q2277");
    expect(contrib.confidence).toBeGreaterThanOrEqual(1);
    expect(contrib.confidence).toBeLessThanOrEqual(99);
  });

  it("honors an entityType override", () => {
    const contrib = draftToContribution(draft, { entityType: "archaeological-site" });
    expect(contrib.entityType).toBe("archaeological-site");
  });
});

describe("overallConfidence", () => {
  it("returns a 1..99 integer", () => {
    const draft = draftFromWikidataEntity(loadEntity("Q2277"), {
      kind: "wikidata",
      sourceUrl: "https://www.wikidata.org/wiki/Q2277",
    });
    const c = overallConfidence(draft);
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(99);
  });
});
