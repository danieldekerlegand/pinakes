import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for `POST /api/timeline/event` (US-002). The route is wired
 * to a `ContributionService` pointed at a temp dir so authored entries land in
 * an isolated queue (no real `data/runtime/contributions/` writes).
 */

import { registerTimelineEventRoutes } from "./timeline-event";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-event-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerTimelineEventRoutes(app, contributions);
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
  const res = await fetch(`${baseUrl}/api/timeline/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/timeline/event", () => {
  it("persists a point-in-time event into the queue with user-authored provenance", async () => {
    const { status, body } = await post({
      kind: "event",
      cultureProfileId: "cp-sumerian",
      title: "Emergence of Sumerian City-States",
      lane: "political",
      eventType: "founding",
      magnitude: "major",
      timePeriodStart: -4500,
      confidence: 70,
      contributorName: "Ada",
    });

    expect(status).toBe(201);
    expect(body.contribution).toBeTruthy();
    expect(body.contribution.status).toBe("pending");
    expect(body.contribution.entityType).toBe("timeline-event");
    expect(body.contribution.entityData.source).toBe("user-authored");
    expect(body.contribution.entityData.timePeriodEnd).toBeNull();
    expect(body.contribution.entityId).toBe("cp-sumerian");

    const stored = contributions.get(body.contribution.id);
    expect(stored).not.toBeNull();
    expect(stored?.entityData.source).toBe("user-authored");
  });

  it("persists a dated period with start and end years", async () => {
    const { status, body } = await post({
      kind: "period",
      cultureProfileId: "roman-empire",
      title: "Pax Romana",
      lane: "political",
      timePeriodStart: -27,
      timePeriodEnd: 180,
    });
    expect(status).toBe(201);
    expect(body.contribution.entityData.timePeriodStart).toBe(-27);
    expect(body.contribution.entityData.timePeriodEnd).toBe(180);
  });

  it("rejects an entry with no associated entity", async () => {
    const { status, body } = await post({
      kind: "event",
      title: "Orphan",
      lane: "political",
      timePeriodStart: -200,
    });
    expect(status).toBe(400);
    expect(body.errors.some((e: string) => /cultureProfileId/.test(e))).toBe(true);
  });

  it("rejects an inverted period range", async () => {
    const { status, body } = await post({
      kind: "period",
      cultureProfileId: "roman-empire",
      title: "Backwards",
      lane: "political",
      timePeriodStart: 400,
      timePeriodEnd: -200,
    });
    expect(status).toBe(400);
    expect(body.errors.some((e: string) => /inverted range/.test(e))).toBe(true);
  });

  it("rejects an out-of-bounds year", async () => {
    const { status, body } = await post({
      kind: "event",
      cultureProfileId: "roman-empire",
      title: "Far future",
      lane: "political",
      timePeriodStart: 99999,
    });
    expect(status).toBe(400);
    expect(body.errors.some((e: string) => /out of bounds/.test(e))).toBe(true);
  });

  it("rejects an unknown lane", async () => {
    const { status } = await post({
      kind: "event",
      cultureProfileId: "roman-empire",
      title: "Bad lane",
      lane: "banana",
      timePeriodStart: 100,
    });
    expect(status).toBe(400);
  });

  it("exposes the authoring options (kinds, lanes, magnitudes, bounds)", async () => {
    const res = await fetch(`${baseUrl}/api/timeline/event/options`);
    const body = await res.json();
    expect(body.kinds).toContain("event");
    expect(body.kinds).toContain("period");
    expect(body.lanes).toContain("political");
    expect(body.magnitudes).toContain("major");
    expect(typeof body.minYear).toBe("number");
    expect(typeof body.maxYear).toBe("number");
  });
});
