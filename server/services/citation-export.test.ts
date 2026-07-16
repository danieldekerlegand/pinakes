import { describe, it, expect } from "vitest";

import {
  CITATION_FORMATS,
  DATASET_PUBLISHER,
  entityToBibtex,
  entityToCslItems,
  entityToCslJson,
  entityToRis,
  isCitationFormat,
  parseEntitySources,
  parseSourceString,
  recordCiteKey,
  renderCitation,
  type CitableEntity,
} from "./citation-export";

const minoan: CitableEntity = {
  entityType: "culture-profile",
  id: "minoan",
  name: "Minoan Civilization",
  sources: ["Evans 1921", "Archaeological evidence"],
  year: -2000,
  region: "Crete",
  url: "https://example.test/culture-profile/minoan",
};

describe("parseEntitySources", () => {
  it("passes through a real string array, trimming + dropping blanks", () => {
    expect(parseEntitySources([" Evans 1921 ", "", "Cauvin 2000"])).toEqual([
      "Evans 1921",
      "Cauvin 2000",
    ]);
  });

  it("parses a JSON-array TSV cell", () => {
    expect(parseEntitySources('["Hesiod Theogony","Homer Iliad"]')).toEqual([
      "Hesiod Theogony",
      "Homer Iliad",
    ]);
  });

  it("treats a plain string as a single source", () => {
    expect(parseEntitySources("Homer Iliad")).toEqual(["Homer Iliad"]);
  });

  it("returns [] for null / empty / non-string input", () => {
    expect(parseEntitySources(null)).toEqual([]);
    expect(parseEntitySources("")).toEqual([]);
    expect(parseEntitySources("[]")).toEqual([]);
    expect(parseEntitySources(42)).toEqual([]);
  });
});

describe("parseSourceString", () => {
  it("splits a trailing year into author + year", () => {
    const p = parseSourceString("Kuijt 2002");
    expect(p.author).toBe("Kuijt");
    expect(p.year).toBe(2002);
    expect(p.title).toBe("Kuijt");
  });

  it("recovers a url and leaves title as the raw text when no author/year", () => {
    const p = parseSourceString("See https://doi.org/10.1000/xyz for details");
    expect(p.url).toBe("https://doi.org/10.1000/xyz");
    expect(p.author).toBeUndefined();
    expect(p.title).toBe("See https://doi.org/10.1000/xyz for details");
  });

  it("does not treat a small trailing number as a year", () => {
    const p = parseSourceString("Site 12");
    expect(p.year).toBeUndefined();
    expect(p.title).toBe("Site 12");
  });
});

describe("entityToBibtex", () => {
  it("emits a record entry plus one entry per source", () => {
    const bib = entityToBibtex(minoan);
    // record entry
    expect(bib).toContain(`@misc{${recordCiteKey(minoan)},`);
    expect(bib).toContain("title = {Minoan Civilization}");
    expect(bib).toContain(`howpublished = {${DATASET_PUBLISHER}}`);
    expect(bib).toContain("year = {-2000}");
    expect(bib).toContain("url = {https://example.test/culture-profile/minoan}");
    // author/year source entry
    expect(bib).toContain("@misc{minoan-evans-1921,");
    expect(bib).toContain("author = {Evans}");
    expect(bib).toContain("year = {1921}");
    // descriptor-only source entry
    expect(bib).toContain("title = {Archaeological evidence}");
    // three entries total (record + 2 sources)
    expect((bib.match(/@misc\{/g) ?? []).length).toBe(3);
  });

  it("still yields a usable record citation when sources are empty (AC3)", () => {
    const bare: CitableEntity = { entityType: "deity", id: "zeus", name: "Zeus", sources: [] };
    const bib = entityToBibtex(bare);
    expect((bib.match(/@misc\{/g) ?? []).length).toBe(1);
    expect(bib).toContain("@misc{pinakes-deity-zeus,");
    expect(bib).toContain("title = {Zeus}");
  });

  it("gives colliding source keys distinct suffixes", () => {
    const dup: CitableEntity = {
      entityType: "civilization",
      id: "x",
      name: "X",
      sources: ["Smith 1990", "Smith 1990"],
    };
    const bib = entityToBibtex(dup);
    expect(bib).toContain("@misc{x-smith-1990,");
    expect(bib).toContain("@misc{x-smith-1990-2,");
  });

  it("escapes TeX-special characters and strips stray braces", () => {
    const tricky: CitableEntity = {
      entityType: "culture-profile",
      id: "y",
      name: "Trade & Craft {Guild} 50% #1",
      sources: [],
    };
    const bib = entityToBibtex(tricky);
    expect(bib).toContain("Trade \\& Craft Guild 50\\% \\#1");
  });
});

describe("entityToRis", () => {
  it("emits a DATA record then a GEN record per source, each closed with ER", () => {
    const ris = entityToRis(minoan);
    expect(ris).toContain("TY  - DATA");
    expect(ris).toContain("TI  - Minoan Civilization");
    expect(ris).toContain("PY  - -2000");
    expect(ris).toContain("TY  - GEN");
    expect(ris).toContain("AU  - Evans");
    expect((ris.match(/ER  - /g) ?? []).length).toBe(3);
  });
});

describe("entityToCslJson", () => {
  it("produces a dataset item + document items with structured fields", () => {
    const items = entityToCslItems(minoan);
    expect(items[0].type).toBe("dataset");
    expect(items[0].title).toBe("Minoan Civilization");
    expect(items[0].issued).toEqual({ "date-parts": [[-2000]] });
    expect(items[1].author).toEqual([{ family: "Evans" }]);
    expect(items[1].issued).toEqual({ "date-parts": [[1921]] });
    // valid JSON round-trips
    expect(JSON.parse(entityToCslJson(minoan))).toHaveLength(3);
  });
});

describe("renderCitation / format helpers", () => {
  it("exposes the three formats", () => {
    expect(CITATION_FORMATS).toEqual(["bibtex", "ris", "csljson"]);
    expect(isCitationFormat("bibtex")).toBe(true);
    expect(isCitationFormat("mla")).toBe(false);
  });

  it("returns content, content-type, and a slugged filename per format", () => {
    expect(renderCitation(minoan, "bibtex").filename).toBe("minoan.bib");
    expect(renderCitation(minoan, "ris").filename).toBe("minoan.ris");
    const csl = renderCitation(minoan, "csljson");
    expect(csl.filename).toBe("minoan.json");
    expect(csl.contentType).toContain("csl+json");
    expect(csl.content).toBe(entityToCslJson(minoan));
  });
});
