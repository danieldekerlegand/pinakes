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
 *
 * The POST is **still served here** after pinakes:65 US-2, because its recorded
 * `post-timeline-event-invalid` fixture is replayed against this app — so these
 * cases stay. `GET /api/timeline/event/options` was retired to 501 and its
 * behaviour is graded on the Python side by
 * `services/api/tests/test_timeline_event.py`.
 */

import { registerTimelineEventRoutes, PORTED_ROUTE, PORTED_TO, PORTED_ERROR } from "./timeline-event";
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

  it("answers 501 on the retired options route, naming the Python module", async () => {
    // 501, not 404: a 404 would say "gone" and would drop the route out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    const res = await fetch(`${baseUrl}${PORTED_ROUTE}`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`GET ${PORTED_ROUTE}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });
});
