import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Unit tests for the culture-scrape Wikidata bulk-acquisition pipeline (US-005).
 * The job runner is faked (recorded records, no Python/network) and the
 * ContributionService points at a temp dir so drafts land in an isolated queue.
 */

import { ContributionService } from "./contribution-service";
import {
  ACQUISITION_CATALOG,
  buildAcquisitionQuery,
  buildCategorySpecYaml,
  listAcquisitionCategories,
  parseRawRecords,
  parseWktPoint,
  recordToContribution,
  resolveAcquisitionCategory,
  runAcquisitionJob,
  type AcquisitionCategory,
  type CultureScrapeJobRunner,
  type RawRecord,
} from "./culturescrape-acquisition";

const CIV = ACQUISITION_CATALOG.civilizations;
const SITES = ACQUISITION_CATALOG.sites;
const FIGURES = ACQUISITION_CATALOG.figures;
const GOODS = ACQUISITION_CATALOG["trade-goods"];

function rawRecord(fields: Record<string, string>, source_query = "SELECT ..."): RawRecord {
  return {
    fields,
    provenance: {
      source: "wikidata",
      source_url: fields.item ?? "",
      source_query,
      retrieved_at: "2026-07-05T00:00:00Z",
      confidence: 1,
      license: null,
    },
  };
}

function fakeRunner(records: RawRecord[]): CultureScrapeJobRunner {
  return {
    async runFetch(category) {
      return {
        records,
        report: {
          category_id: category.id,
          adapter: "wikidata-sparql",
          row_count: records.length,
          error_count: 0,
          distinct_sources: ["wikidata"],
        },
      };
    },
  };
}

describe("catalog", () => {
  it("exposes exactly the four acquirable domains", () => {
    const domains = listAcquisitionCategories().map((c) => c.domain).sort();
    expect(domains).toEqual(["civilizations", "figures", "sites", "trade-goods"]);
  });

  it("maps each domain to a valid ContributionEntityType", () => {
    expect(CIV.entityType).toBe("civilization");
    expect(SITES.entityType).toBe("archaeological-site");
    expect(FIGURES.entityType).toBe("historical-figure");
    expect(GOODS.entityType).toBe("trade-good");
  });

  it("resolves a known domain and rejects unknown/undefined", () => {
    expect(resolveAcquisitionCategory("sites")).toBe(SITES);
    expect(resolveAcquisitionCategory("nope")).toBeUndefined();
    expect(resolveAcquisitionCategory(undefined)).toBeUndefined();
  });
});

describe("buildAcquisitionQuery / buildCategorySpecYaml", () => {
  it("selects the domain's Wikidata class and applies an optional LIMIT", () => {
    const q = buildAcquisitionQuery(CIV, 250);
    expect(q).toContain("wdt:P31 wd:Q11772");
    expect(q).toContain("LIMIT 250");
  });

  it("omits LIMIT when none/invalid is given", () => {
    expect(buildAcquisitionQuery(CIV)).not.toContain("LIMIT");
    expect(buildAcquisitionQuery(CIV, 0)).not.toContain("LIMIT");
  });

  it("binds coordinates for coordinate-required domains and makes them OPTIONAL otherwise", () => {
    expect(buildAcquisitionQuery(SITES)).toContain("?item wdt:P625 ?coord .");
    expect(buildAcquisitionQuery(SITES)).not.toContain("OPTIONAL { ?item wdt:P625");
    expect(buildAcquisitionQuery(CIV)).toContain("OPTIONAL { ?item wdt:P625 ?coord . }");
  });

  it("emits a culture-scrape category spec with the wikidata-sparql source", () => {
    const yaml = buildCategorySpecYaml(SITES, 10);
    expect(yaml).toContain("id: wikidata-archaeological-sites");
    expect(yaml).toContain("type: wikidata-sparql");
    expect(yaml).toContain("wdt:P31 wd:Q839954");
    expect(yaml).toContain("LIMIT 10");
  });
});

describe("parseWktPoint", () => {
  it("parses Point(lng lat) into {lat,lng}", () => {
    expect(parseWktPoint("Point(2.5 48.8)")).toEqual({ lat: 48.8, lng: 2.5 });
    expect(parseWktPoint("Point(-73.9 40.7)")).toEqual({ lat: 40.7, lng: -73.9 });
  });

  it("rejects malformed / out-of-range points and undefined", () => {
    expect(parseWktPoint(undefined)).toBeNull();
    expect(parseWktPoint("not a point")).toBeNull();
    expect(parseWktPoint("Point(200 100)")).toBeNull();
  });
});

describe("parseRawRecords", () => {
  it("parses jsonl lines and skips blanks / garbage", () => {
    const jsonl = [
      JSON.stringify(rawRecord({ itemLabel: "Rome", qid: "Q220" })),
      "",
      "not json",
      JSON.stringify({ fields: 1, provenance: 2 }), // wrong shape → skipped
      JSON.stringify(rawRecord({ itemLabel: "Athens", qid: "Q1524" })),
    ].join("\n");
    const records = parseRawRecords(jsonl);
    expect(records).toHaveLength(2);
    expect(records[0].fields.itemLabel).toBe("Rome");
    expect(records[1].fields.itemLabel).toBe("Athens");
  });
});

describe("recordToContribution", () => {
  it("maps a labeled record to an auto-derived add with Wikidata provenance", () => {
    const draft = recordToContribution(
      rawRecord({
        item: "http://www.wikidata.org/entity/Q220",
        itemLabel: "Roman Empire",
        qid: "Q220",
        image: "http://commons/roman.jpg",
      }),
      CIV,
    );
    expect(draft).not.toBeNull();
    expect(draft!.entityType).toBe("civilization");
    expect(draft!.action).toBe("add");
    const data = draft!.entityData as Record<string, unknown>;
    expect(data.name).toBe("Roman Empire");
    expect(data.source).toBe("culturescrape-wikidata");
    expect(data.autoDerived).toBe(true);
    expect(data.aiGenerated).toBe(false);
    expect(data.wikidataQid).toBe("Q220");
    expect(data.domain).toBe("civilizations");
    expect(draft!.sources?.[0].url).toBe("http://www.wikidata.org/entity/Q220");
    // confidence < 100 so it always reads as "needs review".
    expect(draft!.confidence).toBeGreaterThan(0);
    expect(draft!.confidence).toBeLessThan(100);
  });

  it("skips records with no usable label (label == QID)", () => {
    expect(recordToContribution(rawRecord({ itemLabel: "Q999", qid: "Q999" }), CIV)).toBeNull();
    expect(recordToContribution(rawRecord({ itemLabel: "", qid: "Q1" }), CIV)).toBeNull();
  });

  it("requires coordinates for site domains, and attaches them when present", () => {
    // No coord → skipped for a coordinate-required domain.
    expect(recordToContribution(rawRecord({ itemLabel: "Some Site", qid: "Q1" }), SITES)).toBeNull();
    // Coord present → coordinates on entityData (satisfies archaeological-site required field).
    const draft = recordToContribution(
      rawRecord({ itemLabel: "Machu Picchu", qid: "Q676203", coord: "Point(-72.5 -13.1)" }),
      SITES,
    );
    expect(draft).not.toBeNull();
    const data = draft!.entityData as Record<string, unknown>;
    expect(data.coordinates).toEqual({ lat: -13.1, lng: -72.5 });
  });

  it("synthesizes a wikidata source URL when the record has no source_url", () => {
    const record = rawRecord({ itemLabel: "Amber", qid: "Q272626" });
    record.provenance.source_url = "";
    const draft = recordToContribution(record, GOODS);
    expect(draft!.sources?.[0].url).toBe("https://www.wikidata.org/wiki/Q272626");
  });
});

describe("runAcquisitionJob", () => {
  let dir: string;
  let contributions: ContributionService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-acq-svc-"));
    contributions = new ContributionService(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fetches, enqueues usable records, and reports skipped counts", async () => {
    const records = [
      rawRecord({ itemLabel: "Roman Empire", qid: "Q220" }),
      rawRecord({ itemLabel: "Q999", qid: "Q999" }), // no label → skipped
      rawRecord({ itemLabel: "Maya civilization", qid: "Q13217" }),
    ];
    const progress: string[] = [];
    const result = await runAcquisitionJob({
      category: CIV,
      runner: fakeRunner(records),
      contributions,
      onProgress: (p) => progress.push(p.phase),
    });

    expect(result.acquired).toBe(3);
    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.contributionIds).toHaveLength(2);
    expect(result.report.row_count).toBe(3);

    // Progress phases streamed start → done.
    expect(progress[0]).toBe("starting");
    expect(progress[progress.length - 1]).toBe("done");

    // Contributions actually persisted as pending civilization adds.
    const { contributions: queued } = contributions.list({ entityType: "civilization" });
    expect(queued).toHaveLength(2);
    expect(queued.every((c) => c.status === "pending")).toBe(true);
    expect(queued.every((c) => c.entityData.source === "culturescrape-wikidata")).toBe(true);
  });

  it("stops enqueueing once the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAcquisitionJob({
      category: CIV,
      runner: fakeRunner([rawRecord({ itemLabel: "Rome", qid: "Q220" })]),
      contributions,
      signal: controller.signal,
    });
    expect(result.queued).toBe(0);
  });
});
