import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for `POST /api/map/drawn-geometry` (US-001). The route is
 * wired to a `ContributionService` pointed at a temp dir so drawn geometries
 * land in an isolated queue (no real `data/contributions/` writes).
 */

import { registerDrawnGeometryRoutes } from "./drawn-geometry";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

const SQUARE = {
  type: "Polygon" as const,
  coordinates: [[[0, 40], [2, 40], [2, 42], [0, 42], [0, 40]]],
};
const LINE = {
  type: "LineString" as const,
  coordinates: [[108.94, 34.26], [105, 36], [95, 38]],
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawn-geometry-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerDrawnGeometryRoutes(app, contributions);
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
  const res = await fetch(`${baseUrl}/api/map/drawn-geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/map/drawn-geometry", () => {
  it("persists a drawn polygon into the contribution queue with user-drawn provenance", async () => {
    const { status, body } = await post({
      geometry: SQUARE,
      target: "boundary",
      name: "Roman Republic (200 BCE)",
      associatedEntityId: "roman-empire",
      timePeriodStart: -200,
      timePeriodEnd: -100,
      confidence: 80,
      contributorName: "Ada",
    });

    expect(status).toBe(201);
    expect(body.contribution).toBeTruthy();
    expect(body.contribution.status).toBe("pending");
    expect(body.contribution.entityType).toBe("boundary");
    expect(body.contribution.entityData.source).toBe("user-drawn");
    expect(body.contribution.entityData.geometry).toEqual(SQUARE);
    expect(body.contribution.entityId).toBe("roman-empire");

    // Round-trips through the service (actually persisted to disk).
    const stored = contributions.get(body.contribution.id);
    expect(stored).not.toBeNull();
    expect(stored?.entityData.source).toBe("user-drawn");
  });

  it("persists a drawn line for a route target", async () => {
    const { status, body } = await post({
      geometry: LINE,
      target: "trade-route",
      name: "Silk Road",
      associatedEntityId: "tr-001",
      timePeriodStart: -200,
      timePeriodEnd: 1450,
    });
    expect(status).toBe(201);
    expect(body.contribution.entityType).toBe("trade-route");
    expect(body.contribution.entityData.drawingMode).toBe("polyline");
  });

  it("rejects a submission with no associated entity", async () => {
    const { status, body } = await post({
      geometry: SQUARE,
      target: "boundary",
      name: "Orphan",
      timePeriodStart: -200,
    });
    expect(status).toBe(400);
    expect(body.errors.some((e: string) => /associatedEntityId/.test(e))).toBe(true);
  });

  it("rejects an inverted time range", async () => {
    const { status, body } = await post({
      geometry: SQUARE,
      target: "boundary",
      name: "Backwards",
      associatedEntityId: "roman-empire",
      timePeriodStart: 400,
      timePeriodEnd: -200,
    });
    expect(status).toBe(400);
    expect(body.errors.some((e: string) => /inverted range/.test(e))).toBe(true);
  });

  it("rejects a geometry/target mismatch", async () => {
    const { status } = await post({
      geometry: LINE,
      target: "boundary",
      name: "Line as boundary",
      associatedEntityId: "roman-empire",
      timePeriodStart: -200,
    });
    expect(status).toBe(400);
  });

  it("rejects a malformed (unclosed) polygon", async () => {
    const { status } = await post({
      geometry: { type: "Polygon", coordinates: [[[0, 40], [2, 40], [2, 42], [0, 42]]] },
      target: "boundary",
      name: "Open ring",
      associatedEntityId: "roman-empire",
      timePeriodStart: -200,
    });
    expect(status).toBe(400);
  });

  it("exposes the valid drawing targets", async () => {
    const res = await fetch(`${baseUrl}/api/map/drawn-geometry/targets`);
    const body = await res.json();
    expect(body.targets).toContain("boundary");
    expect(body.targets).toContain("migration-route");
  });
});
