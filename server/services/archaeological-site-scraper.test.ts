import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Unit tests for the Open Context / tDAR archaeological adapters (US-007). The
 * network is faked with recorded fixtures (no live fetch) and the
 * ContributionService points at a temp dir so acquired sites land in an isolated
 * queue.
 */

import { ContributionService } from "./contribution-service";
import {
  ARCHAEOLOGY_SOURCES,
  listArchaeologySources,
  openContextToScrapedSite,
  resolveArchaeologySource,
  runArchaeologicalAcquisition,
  scrapeArchaeologySource,
  siteToContribution,
  tdarToScrapedSite,
  type ArchaeologyDeps,
  type OpenContextResponse,
  type TdarResponse,
} from "./archaeological-site-scraper";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "archaeological");

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf-8")) as T;
}

const openContextFixture = loadFixture<OpenContextResponse>("open-context-search");
const tdarFixture = loadFixture<TdarResponse>("tdar-search");

function fixtureDeps(overrides: Partial<ArchaeologyDeps> = {}): ArchaeologyDeps {
  return {
    async fetchOpenContext() {
      return openContextFixture;
    },
    async fetchTdar() {
      return tdarFixture;
    },
    ...overrides,
  };
}

describe("catalog", () => {
  it("exposes the two archaeological sources", () => {
    expect(listArchaeologySources().map((s) => s.id).sort()).toEqual([
      "open-context",
      "tdar",
    ]);
  });

  it("resolves a known source and rejects unknown/undefined", () => {
    expect(resolveArchaeologySource("tdar")).toBe(ARCHAEOLOGY_SOURCES.tdar);
    expect(resolveArchaeologySource("nope")).toBeUndefined();
    expect(resolveArchaeologySource(undefined)).toBeUndefined();
  });
});

describe("openContextToScrapedSite", () => {
  it("maps a feature to a site with coordinates, time range, culture, and provenance", () => {
    const site = openContextToScrapedSite(openContextFixture.features![0]);
    expect(site).not.toBeNull();
    expect(site!.name).toBe("Çatalhöyük East Mound");
    expect(site!.coordinates).toEqual({ lat: 37.6669, lng: 32.8281 });
    expect(site!.timePeriodStart).toBe(-7100);
    expect(site!.timePeriodEnd).toBe(-5700);
    // Culture derived from the leaf of the context path.
    expect(site!.associatedCultureIds).toContain("catalhoyuk");
    expect(site!.provenance).toEqual({
      source: "open-context",
      sourceId: "https://opencontext.org/subjects/catalhoyuk-east",
      sourceUrl: "https://opencontext.org/subjects/catalhoyuk-east",
    });
  });

  it("prefers an explicit cultures list over the context leaf", () => {
    const site = openContextToScrapedSite(openContextFixture.features![1]);
    expect(site!.associatedCultureIds).toEqual([
      "natufian",
      "pre-pottery-neolithic",
    ]);
  });

  it("returns null for a [0,0] point and for a record with no label", () => {
    expect(openContextToScrapedSite(openContextFixture.features![2])).toBeNull();
    expect(openContextToScrapedSite(openContextFixture.features![3])).toBeNull();
  });
});

describe("tdarToScrapedSite", () => {
  it("maps a resource with explicit lat/lng, cultures, and provenance", () => {
    const site = tdarToScrapedSite(tdarFixture.resources![0]);
    expect(site).not.toBeNull();
    expect(site!.name).toBe("Snaketown Excavation Records");
    expect(site!.coordinates).toEqual({ lat: 33.1836, lng: -111.9075 });
    expect(site!.timePeriodStart).toBe(300);
    expect(site!.timePeriodEnd).toBe(1100);
    expect(site!.associatedCultureIds).toEqual(["hohokam"]);
    expect(site!.provenance).toEqual({
      source: "tdar",
      sourceId: "391847",
      sourceUrl: "https://core.tdar.org/document/391847",
    });
  });

  it("derives coordinates from a bounding box centroid when no point is given", () => {
    const site = tdarToScrapedSite(tdarFixture.resources![1]);
    expect(site).not.toBeNull();
    expect(site!.coordinates.lat).toBeCloseTo(36.06, 5);
    expect(site!.coordinates.lng).toBeCloseTo(-107.96, 5);
    expect(site!.associatedCultureIds).toEqual(["ancestral-puebloan", "chacoan"]);
  });

  it("returns null when a resource has no coordinates", () => {
    expect(tdarToScrapedSite(tdarFixture.resources![2])).toBeNull();
  });

  it("returns null when a resource has no title", () => {
    expect(tdarToScrapedSite(tdarFixture.resources![3])).toBeNull();
  });
});

describe("scrapeArchaeologySource", () => {
  it("normalizes Open Context features, dropping unusable ones", async () => {
    const sites = await scrapeArchaeologySource("open-context", {}, fixtureDeps());
    expect(sites.map((s) => s.name)).toEqual([
      "Çatalhöyük East Mound",
      "Jericho Tell es-Sultan",
    ]);
  });

  it("normalizes tDAR resources, dropping unusable ones", async () => {
    const sites = await scrapeArchaeologySource("tdar", {}, fixtureDeps());
    expect(sites.map((s) => s.name)).toEqual([
      "Snaketown Excavation Records",
      "Chaco Canyon Great House Survey",
    ]);
  });
});

describe("siteToContribution", () => {
  it("maps a scraped site to an auto-derived archaeological-site add with provenance", () => {
    const site = openContextToScrapedSite(openContextFixture.features![0])!;
    const draft = siteToContribution(site);
    expect(draft).not.toBeNull();
    expect(draft!.entityType).toBe("archaeological-site");
    expect(draft!.action).toBe("add");
    const data = draft!.entityData as Record<string, unknown>;
    expect(data.name).toBe("Çatalhöyük East Mound");
    expect(data.coordinates).toEqual({ lat: 37.6669, lng: 32.8281 });
    expect(data.source).toBe("open-context");
    expect(data.autoDerived).toBe(true);
    expect(data.aiGenerated).toBe(false);
    expect(draft!.sources?.[0].url).toBe(
      "https://opencontext.org/subjects/catalhoyuk-east",
    );
    expect(draft!.confidence).toBeGreaterThan(0);
    expect(draft!.confidence).toBeLessThan(100);
  });
});

describe("runArchaeologicalAcquisition", () => {
  let dir: string;
  let contributions: ContributionService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-acq-"));
    contributions = new ContributionService(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fetches, enqueues usable sites, and streams progress", async () => {
    const phases: string[] = [];
    const result = await runArchaeologicalAcquisition({
      source: "open-context",
      contributions,
      deps: fixtureDeps(),
      onProgress: (p) => phases.push(p.phase),
    });

    expect(result.acquired).toBe(2);
    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.contributionIds).toHaveLength(2);
    expect(phases[0]).toBe("starting");
    expect(phases[phases.length - 1]).toBe("done");

    const { contributions: queued } = contributions.list({
      entityType: "archaeological-site",
    });
    expect(queued).toHaveLength(2);
    expect(queued.every((c) => c.status === "pending")).toBe(true);
    expect(queued.every((c) => c.entityData.source === "open-context")).toBe(true);
  });

  it("stops enqueueing once the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runArchaeologicalAcquisition({
      source: "tdar",
      contributions,
      deps: fixtureDeps(),
      signal: controller.signal,
    });
    expect(result.queued).toBe(0);
  });

  it("propagates a fetch failure", async () => {
    await expect(
      runArchaeologicalAcquisition({
        source: "tdar",
        contributions,
        deps: fixtureDeps({
          async fetchTdar() {
            throw new Error("network down");
          },
        }),
      }),
    ).rejects.toThrow("network down");
  });
});
