import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of the `/api/annotations/*` routes on this backend
 * (pinakes:61 US-1).
 *
 * The note CRUD — the entity-keyed list, the private-by-default visibility, the
 * owner-free projection — is served by the Python service now, and its
 * behavioural coverage moved with it to
 * `services/api/tests/test_annotation_routes.py`. What this file asserts is the
 * hand-off: the retired paths are still *registered* (the parity baseline was
 * harvested from that path set) and answer 501 naming their replacement, and
 * nothing on this side still writes to `data/runtime/annotations`.
 *
 * `server/services/annotations.ts` is still unit-tested next door — it is the
 * specification the port was read off.
 */

import { PORTED_ERROR, PORTED_ROUTES, PORTED_TO, registerAnnotationRoutes } from "./annotations";
import { AnnotationStore } from "../services/annotations";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let store: AnnotationStore;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "annotations-routes-"));
  store = new AnnotationStore(dir);
  app = express();
  app.use(express.json());
  registerAnnotationRoutes(app);
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

async function req(method: string, p: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { "x-owner-id": "alice" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Concrete URLs for the retired templates, by the method that was retired. */
const RETIRED: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/api/annotations?entity=cs:language:eng"],
  ["GET", "/api/annotations/note_1"],
  ["POST", "/api/annotations"],
  ["PATCH", "/api/annotations/note_1"],
  ["DELETE", "/api/annotations/note_1"],
];

describe("routes ported to the Python service", () => {
  it.each(RETIRED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const { status, body } = await req(method, url, method === "GET" ? undefined : {});
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps every retired path registered", () => {
    // Deleting a registration would rewrite the parity baseline the port is
    // graded against — `contracts/parity/openapi.json` is harvested from the
    // Express routing table.
    const registered = [
      ...PORTED_ROUTES.get,
      ...PORTED_ROUTES.post,
      ...PORTED_ROUTES.patch,
      ...PORTED_ROUTES.delete,
    ];
    expect(registered).toContain("/api/annotations");
    expect(registered).toContain("/api/annotations/:id");
    // Five method+path pairs across two distinct paths — the baseline's five.
    expect(registered).toHaveLength(5);
    expect(new Set(registered).size).toBe(2);
  });

  it("never writes to the annotations tree on a retired write", async () => {
    await req("POST", "/api/annotations", {
      type: "language",
      id: "eng",
      body: "A note about English",
    });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(store.listForEntity("cs:language:eng", "alice")).toEqual([]);
  });
});
