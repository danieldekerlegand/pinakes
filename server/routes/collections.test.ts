import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the `/api/collections/*` routes (US-007). The route is
 * wired to a `CollectionStore` pointed at a temp dir (no shared state, no real
 * `data/` writes). Ownership is exercised via the `x-owner-id` header.
 */

import { registerCollectionRoutes } from "./collections";
import { CollectionStore } from "../services/collections";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "collections-routes-"));
  app = express();
  app.use(express.json());
  registerCollectionRoutes(app, new CollectionStore(dir));
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

async function req(method: string, path: string, owner?: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = {};
  if (owner) headers["x-owner-id"] = owner;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("collections CRUD over HTTP", () => {
  it("rejects a collection without a title", async () => {
    const { status, body } = await req("POST", "/api/collections", "alice", { description: "no title" });
    expect(status).toBe(400);
    expect(body.errors).toContain("title is required");
  });

  it("runs the full create → get → list → add → remove → update → delete lifecycle", async () => {
    // create
    const created = await req("POST", "/api/collections", "alice", {
      title: "Bronze Age",
      items: [{ type: "culture", id: "sumer", name: "Sumer" }],
    });
    expect(created.status).toBe(201);
    const id = created.body.collection.id;
    expect(created.body.collection.items).toHaveLength(1);
    const token = created.body.collection.shareToken;

    // get (owner)
    const got = await req("GET", `/api/collections/${id}`, "alice");
    expect(got.status).toBe(200);
    expect(got.body.collection.title).toBe("Bronze Age");

    // list (owner-scoped)
    const list = await req("GET", "/api/collections", "alice");
    expect(list.body.total).toBe(1);
    const otherList = await req("GET", "/api/collections", "bob");
    expect(otherList.body.total).toBe(0);

    // add item
    const added = await req("POST", `/api/collections/${id}/items`, "alice", {
      type: "battle",
      id: "kadesh",
      name: "Kadesh",
    });
    expect(added.status).toBe(200);
    expect(added.body.collection.items).toHaveLength(2);

    // remove item by stable id
    const removed = await req("DELETE", `/api/collections/${id}/items/cs:battle:kadesh`, "alice");
    expect(removed.status).toBe(200);
    expect(removed.body.collection.items).toHaveLength(1);

    // update metadata
    const updated = await req("PATCH", `/api/collections/${id}`, "alice", {
      title: "Bronze Age Cultures",
      visibility: "public",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.collection.title).toBe("Bronze Age Cultures");
    expect(updated.body.collection.visibility).toBe("public");

    // shared view resolves by token and hides the owner
    const shared = await req("GET", `/api/collections/shared/${token}`);
    expect(shared.status).toBe(200);
    expect(shared.body.collection).not.toHaveProperty("owner");
    expect(shared.body.collection.itemCount).toBe(1);

    // delete
    const deleted = await req("DELETE", `/api/collections/${id}`, "alice");
    expect(deleted.status).toBe(200);
    expect((await req("GET", `/api/collections/${id}`, "alice")).status).toBe(404);
  });

  it("enforces ownership: a non-owner cannot read private or mutate", async () => {
    const created = await req("POST", "/api/collections", "alice", { title: "Private set" });
    const id = created.body.collection.id;

    // bob cannot read a private collection
    expect((await req("GET", `/api/collections/${id}`, "bob")).status).toBe(403);
    // bob cannot edit
    expect((await req("PATCH", `/api/collections/${id}`, "bob", { title: "hijack" })).status).toBe(403);
    // bob cannot delete
    expect((await req("DELETE", `/api/collections/${id}`, "bob")).status).toBe(403);

    // once public, bob can read it
    await req("PATCH", `/api/collections/${id}`, "alice", { visibility: "public" });
    expect((await req("GET", `/api/collections/${id}`, "bob")).status).toBe(200);
  });

  it("404s unknown ids and share tokens", async () => {
    expect((await req("GET", "/api/collections/col_missing", "alice")).status).toBe(404);
    expect((await req("GET", "/api/collections/shared/badtoken")).status).toBe(404);
  });

  it("400s an item add with an invalid ref", async () => {
    const created = await req("POST", "/api/collections", "alice", { title: "set" });
    const id = created.body.collection.id;
    const bad = await req("POST", `/api/collections/${id}/items`, "alice", { type: "", id: "" });
    expect(bad.status).toBe(400);
  });
});
