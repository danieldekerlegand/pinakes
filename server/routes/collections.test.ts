import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of the `/api/collections/*` routes on this backend
 * (pinakes:61 US-1).
 *
 * The CRUD itself — create, share, add/remove items, ownership — is served by
 * the Python service now, and its behavioural coverage moved with it to
 * `services/api/tests/test_collection_routes.py`. What this file asserts is the
 * hand-off: the retired paths are still *registered* (the parity baseline was
 * harvested from that path set) and answer 501 naming their replacement, and
 * nothing on this side still writes to `data/runtime/collections`.
 *
 * `server/services/collections.ts` is still unit-tested next door — it is the
 * specification the port was read off, and that suite is what says the two
 * agree on the record shape.
 */

import { PORTED_ERROR, PORTED_ROUTES, PORTED_TO, registerCollectionRoutes } from "./collections";
import { CollectionStore } from "../services/collections";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let store: CollectionStore;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "collections-routes-"));
  store = new CollectionStore(dir);
  app = express();
  app.use(express.json());
  registerCollectionRoutes(app);
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
  ["GET", "/api/collections"],
  ["GET", "/api/collections/shared/tok123"],
  ["GET", "/api/collections/col_1"],
  ["POST", "/api/collections"],
  ["POST", "/api/collections/col_1/items"],
  ["PATCH", "/api/collections/col_1"],
  ["DELETE", "/api/collections/col_1"],
  ["DELETE", "/api/collections/col_1/items/cs:culture:sumer"],
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
    expect(registered).toContain("/api/collections/shared/:token");
    expect(registered).toContain("/api/collections/:id/items/:stableId");
    // Eight method+path pairs across five distinct paths — the same eight the
    // baseline lists under `server/routes/collections.ts`.
    expect(registered).toHaveLength(8);
    expect(new Set(registered).size).toBe(5);
  });

  it("keeps `/shared/:token` registered ahead of `/:id`", () => {
    // Both are stubs now, so the order changes no answer here — but it is part
    // of the contract the port reproduces, and the two files should read alike.
    expect(PORTED_ROUTES.get.indexOf("/api/collections/shared/:token")).toBeLessThan(
      PORTED_ROUTES.get.indexOf("/api/collections/:id"),
    );
  });

  it("never writes to the collections tree on a retired write", async () => {
    await req("POST", "/api/collections", { title: "Bronze Age" });
    await req("POST", "/api/collections/col_1/items", { type: "culture", id: "sumer" });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(store.list("alice")).toEqual([]);
  });
});
