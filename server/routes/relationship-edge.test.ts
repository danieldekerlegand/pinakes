import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for `POST /api/relationships/edge` (US-003). The route is
 * wired to a `ContributionService` pointed at a temp dir and an isolated
 * lexicons dir (with a seeded `cultural-lineages.tsv`), so edge creation + dedup
 * are exercised end-to-end with no real `data/contributions/` or corpus writes.
 */

import { registerRelationshipEdgeRoutes } from "./relationship-edge";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let lexiconsDir: string;
let contributions: ContributionService;

const LINEAGE_HEADER =
  "id\tsource_id\tsource_name\ttarget_id\ttarget_name\trelationship_type\ttime_start\ttime_end\tconfidence\tevidence_types\tdescription\tsources";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "relationship-routes-"));
  contributions = new ContributionService(dir);

  lexiconsDir = fs.mkdtempSync(path.join(os.tmpdir(), "relationship-lexicons-"));
  // Seed one existing corpus edge: proto_indo_european --split-from--> proto_anatolian.
  fs.writeFileSync(
    path.join(lexiconsDir, "cultural-lineages.tsv"),
    [
      LINEAGE_HEADER,
      'cl-001\tproto_indo_european\tProto-Indo-European\tproto_anatolian\tProto-Anatolian\tsplit-from\t-4500\t-3500\t80\t["linguistic"]\tSplit\t["Anthony 2007"]',
    ].join("\n") + "\n",
  );

  app = express();
  app.use(express.json());
  registerRelationshipEdgeRoutes(app, { contributions, lexiconsDir });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(lexiconsDir, { recursive: true, force: true });
});

type Res = { status: number; body: any };

async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/relationships/edge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const goodEdge = {
  sourceId: "latin",
  sourceName: "Latin",
  targetId: "french",
  targetName: "French",
  relationshipType: "descended-from",
  timeStart: 100,
  timeEnd: 900,
  confidence: 80,
};

describe("POST /api/relationships/edge", () => {
  it("queues a new relationship with user-authored provenance and a confirmation summary", async () => {
    const { status, body } = await post(goodEdge);
    expect(status).toBe(201);
    expect(body.contribution.entityType).toBe("relationship");
    expect(body.contribution.status).toBe("pending");
    expect(body.contribution.entityData.source).toBe("user-authored");
    expect(body.relationship.relationshipToken).toBe("DESCENDS_FROM");
    expect(body.relationship.sourceName).toBe("Latin");
    expect(body.relationship.targetName).toBe("French");
  });

  it("rejects a self edge with 400", async () => {
    const { status, body } = await post({ ...goodEdge, targetId: "latin", targetName: "Latin" });
    expect(status).toBe(400);
    expect(body.errors.some((e: string) => e.toLowerCase().includes("self edge"))).toBe(true);
  });

  it("rejects a duplicate of the just-queued edge with 409", async () => {
    // goodEdge was queued in the first test — re-submitting must collide.
    const { status, body } = await post(goodEdge);
    expect(status).toBe(409);
    expect(body.duplicate).toBe(true);
    expect(body.errors.some((e: string) => e.includes("already exists"))).toBe(true);
  });

  it("rejects a duplicate of an existing corpus edge with 409", async () => {
    const { status, body } = await post({
      sourceId: "proto_indo_european",
      sourceName: "Proto-Indo-European",
      targetId: "proto_anatolian",
      targetName: "Proto-Anatolian",
      relationshipType: "split-from",
    });
    expect(status).toBe(409);
    expect(body.duplicate).toBe(true);
  });

  it("rejects a non-canonical relationship type with 400", async () => {
    const { status } = await post({ ...goodEdge, targetId: "spanish", relationshipType: "made-up" });
    expect(status).toBe(400);
  });
});

describe("GET /api/relationships/edge/options", () => {
  it("returns the canonical vocabulary and the existing edges for dedup", async () => {
    const res = await fetch(`${baseUrl}/api/relationships/edge/options`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.relationshipTypes.some((t: any) => t.name === "descended-from")).toBe(true);
    // Corpus edge + the queued Latin->French edge should both be present.
    expect(
      body.existingEdges.some(
        (e: any) => e.sourceId === "proto_indo_european" && e.relationshipType === "split-from",
      ),
    ).toBe(true);
    expect(
      body.existingEdges.some(
        (e: any) => e.sourceId === "latin" && e.relationshipType === "descended-from",
      ),
    ).toBe(true);
  });
});
