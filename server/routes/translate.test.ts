import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * What is left of `POST /api/translate` on this backend (pinakes:64 US-1).
 *
 * The proxy is served by the Python service now, and its behavioural coverage
 * moved with it: `services/api/tests/test_ingest_routes.py` (the route, including
 * the 503-with-no-key the client degrades past) and
 * `services/api/tests/test_translate.py` (the service, case for case with
 * `server/services/translate.ts`). What this file asserts is the hand-off.
 *
 * The **security invariant is not asserted here and never was** — it lives in
 * `server/security/translate-proxy.test.ts`, which scans `.env.example` and every
 * `web/` source for the key name and does not care which backend answers the
 * proxy. That is exactly why it survives the port unchanged.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerTranslateRoutes,
} from "./translate";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  registerTranslateRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Res = { status: number; body: any };
async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/translate — ported to the Python service", () => {
  it("answers 501 naming its replacement", async () => {
    const { status, body } = await post({ text: "hola", to: "en" });
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe("POST /api/translate");
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps the path registered", () => {
    expect(PORTED_ROUTES.post).toEqual(["/api/translate"]);
  });

  it("never echoes key material", async () => {
    const { body } = await post({ text: "hola", to: "en" });
    expect(JSON.stringify(body)).not.toMatch(/GOOGLE_TRANSLATE_API_KEY|VITE_GOOGLE/i);
  });
});
