import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for `POST /api/extract/url` (US-004). Network is served from
 * recorded fixtures (no live fetch) and the `ContributionService` points at a
 * temp dir so drafts land in an isolated review queue.
 */

import { registerUrlExtractorRoutes } from "./url-extractor";
import { ContributionService } from "../services/contribution-service";
import {
  UrlExtractionError,
  type UrlExtractorDeps,
  type WikidataEntity,
  type WikipediaPage,
} from "../services/url-extractor";

const FIXTURES = path.join(__dirname, "..", "services", "fixtures", "url-extractor");

function loadEntity(qid: string): WikidataEntity {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `wikidata-${qid}.json`), "utf-8"),
  ) as { entities: Record<string, WikidataEntity> };
  return raw.entities[qid];
}

const fixtureDeps: UrlExtractorDeps = {
  async fetchWikidataEntity(qid: string): Promise<WikidataEntity> {
    const file = path.join(FIXTURES, `wikidata-${qid}.json`);
    if (!fs.existsSync(file)) throw new UrlExtractionError(`Wikidata entity ${qid} not found`);
    return loadEntity(qid);
  },
  async fetchWikipediaPage(lang: string, title: string): Promise<WikipediaPage> {
    const data = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "wikipedia-summary-roman-empire.json"), "utf-8"),
    ) as { title?: string; extract?: string; wikibase_item?: string };
    return { title: data.title ?? title, lang, qid: data.wikibase_item, extract: data.extract };
  },
};

/** Deps whose fetch throws a non-UrlExtractionError to exercise the 502 path. */
const explodingDeps: UrlExtractorDeps = {
  async fetchWikidataEntity(): Promise<WikidataEntity> {
    throw new Error("boom (simulated network failure)");
  },
  async fetchWikipediaPage(): Promise<WikipediaPage> {
    throw new Error("boom");
  },
};

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "url-extractor-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerUrlExtractorRoutes(app, { contributions, deps: fixtureDeps });
  // A second mount on a distinct path is not possible; test 502 via a fresh app.
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

type Res = { status: number; body: any };
async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/extract/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/extract/url", () => {
  it("resolves a Wikidata URL and queues an auto-derived draft", async () => {
    const { status, body } = await post({ url: "https://www.wikidata.org/wiki/Q2277" });
    expect(status).toBe(201);
    expect(body.draft.name.value).toBe("Roman Empire");
    expect(body.contribution.status).toBe("pending");
    expect(body.contribution.entityType).toBe("civilization");
    expect(body.contribution.entityData.source).toBe("auto-derived");
    expect(body.contribution.entityData.aiGenerated).toBe(true);

    // Actually persisted to the temp-dir queue.
    const stored = contributions.get(body.contribution.id);
    expect(stored?.entityData.source).toBe("auto-derived");
  });

  it("resolves a Wikipedia URL through its Wikidata item", async () => {
    const { status, body } = await post({ url: "https://en.wikipedia.org/wiki/Roman_Empire" });
    expect(status).toBe(201);
    expect(body.draft.kind).toBe("wikipedia");
    expect(body.draft.wikidataQid).toBe("Q2277");
  });

  it("honors an allowed entityType override", async () => {
    const { status, body } = await post({
      url: "https://www.wikidata.org/wiki/Q2277",
      entityType: "archaeological-site",
    });
    expect(status).toBe(201);
    expect(body.contribution.entityType).toBe("archaeological-site");
  });

  it("rejects a missing url with 400", async () => {
    const { status } = await post({});
    expect(status).toBe(400);
  });

  it("rejects an unrecognized URL with 400", async () => {
    const { status, body } = await post({ url: "https://example.com/x" });
    expect(status).toBe(400);
    expect(body.message).toMatch(/Wikipedia or Wikidata/i);
  });

  it("rejects an unsupported entityType with 400", async () => {
    const { status } = await post({
      url: "https://www.wikidata.org/wiki/Q2277",
      entityType: "boundary",
    });
    expect(status).toBe(400);
  });
});

describe("POST /api/extract/url source failures", () => {
  let app2: Express;
  let server2: Server;
  let base2: string;

  beforeAll(async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "url-extractor-502-"));
    app2 = express();
    app2.use(express.json());
    registerUrlExtractorRoutes(app2, {
      contributions: new ContributionService(dir2),
      deps: explodingDeps,
    });
    await new Promise<void>((resolve) => {
      server2 = app2.listen(0, "127.0.0.1", () => resolve());
    });
    base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it("maps a source/network failure to 502", async () => {
    const res = await fetch(`${base2}/api/extract/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.wikidata.org/wiki/Q2277" }),
    });
    expect(res.status).toBe(502);
  });
});
