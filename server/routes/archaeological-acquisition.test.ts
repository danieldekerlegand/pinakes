import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * What is left of the Open Context / tDAR acquisition routes on this backend
 * (pinakes:64 US-2).
 *
 * Both are served by the Python service now, and their behavioural coverage
 * moved with them: `services/api/tests/test_archaeology_routes.py` (the routes,
 * including the acquired rows landing in `data/runtime/contributions`) and
 * `services/api/tests/test_archaeology.py` (the adapters, against the same
 * recorded fixtures the TypeScript suite read). What this file asserts is the
 * hand-off.
 *
 * pinakes:70 US-1 then deleted `server/services/archaeological-site-scraper.ts`
 * and its suite along with the rest of the scraper stack, so those Python tests
 * are now the only grading there is — see
 * `engine/src/pinakes_engine/acquire/migration.py`.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerArchaeologyAcquisitionRoutes,
} from "./archaeological-acquisition";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  registerArchaeologyAcquisitionRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Res = { status: number; body: any };

async function get(path: string): Promise<Res> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/scraping/archaeology`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("archaeological acquisition — ported to the Python service", () => {
  it("answers 501 on the sources endpoint, naming its replacement", async () => {
    const { status, body } = await get("/api/scraping/archaeology/sources");
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe("GET /api/scraping/archaeology/sources");
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 on the acquisition endpoint", async () => {
    const { status, body } = await post({ source: "tdar", limit: 50 });
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.route).toBe("POST /api/scraping/archaeology");
  });

  it("starts no job and queues nothing", async () => {
    const { body } = await post({ source: "tdar" });
    expect(body.jobId).toBeUndefined();
  });

  it("keeps both paths registered", () => {
    expect(PORTED_ROUTES.get).toEqual(["/api/scraping/archaeology/sources"]);
    expect(PORTED_ROUTES.post).toEqual(["/api/scraping/archaeology"]);
  });
});
