import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the `/api/annotations/*` routes (US-008). The route is
 * wired to an `AnnotationStore` pointed at a temp dir (no shared state, no real
 * `data/` writes). Ownership is exercised via the `x-owner-id` header.
 */

import { registerAnnotationRoutes } from "./annotations";
import { AnnotationStore } from "../services/annotations";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "annotations-routes-"));
  app = express();
  app.use(express.json());
  registerAnnotationRoutes(app, new AnnotationStore(dir));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
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

describe("annotations CRUD over HTTP", () => {
  it("rejects a note without an entity ref or body", async () => {
    expect((await req("POST", "/api/annotations", "alice", { type: "", id: "", body: "" })).status).toBe(400);
    expect((await req("POST", "/api/annotations", "alice", { type: "language", id: "eng" })).status).toBe(400);
  });

  it("400s a list with no entity", async () => {
    expect((await req("GET", "/api/annotations", "alice")).status).toBe(400);
  });

  it("runs the full create → list → get → update → share → delete lifecycle", async () => {
    // create (private by default)
    const created = await req("POST", "/api/annotations", "alice", {
      type: "language",
      id: "eng",
      name: "English",
      body: "A note about English",
    });
    expect(created.status).toBe(201);
    const id = created.body.annotation.id;
    expect(created.body.annotation).not.toHaveProperty("owner");
    expect(created.body.annotation.editable).toBe(true);
    expect(created.body.annotation.visibility).toBe("private");
    expect(created.body.annotation.stableId).toBe("cs:language:eng");

    // list by entity (owner sees own private)
    const listed = await req("GET", "/api/annotations?entity=cs:language:eng", "alice");
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);

    // list via type+id params resolves the same entity
    const byParams = await req("GET", "/api/annotations?type=language&id=eng", "alice");
    expect(byParams.body.total).toBe(1);

    // a different user does not see the private note
    expect((await req("GET", "/api/annotations?entity=cs:language:eng", "bob")).body.total).toBe(0);

    // get one (owner)
    const got = await req("GET", `/api/annotations/${id}`, "alice");
    expect(got.status).toBe(200);
    expect(got.body.annotation.body).toBe("A note about English");

    // edit body
    const edited = await req("PATCH", `/api/annotations/${id}`, "alice", { body: "Edited note" });
    expect(edited.status).toBe(200);
    expect(edited.body.annotation.body).toBe("Edited note");

    // share it (make public)
    const shared = await req("PATCH", `/api/annotations/${id}`, "alice", { visibility: "public" });
    expect(shared.body.annotation.visibility).toBe("public");

    // now bob sees it, but cannot edit it
    const bobList = await req("GET", "/api/annotations?entity=cs:language:eng", "bob");
    expect(bobList.body.total).toBe(1);
    expect(bobList.body.annotations[0].editable).toBe(false);
    expect(bobList.body.annotations[0]).not.toHaveProperty("owner");

    // delete
    expect((await req("DELETE", `/api/annotations/${id}`, "alice")).status).toBe(200);
    expect((await req("GET", `/api/annotations/${id}`, "alice")).status).toBe(404);
  });

  it("enforces ownership: a non-owner cannot read private or mutate", async () => {
    const created = await req("POST", "/api/annotations", "alice", {
      type: "battle",
      id: "kadesh",
      body: "private note",
    });
    const id = created.body.annotation.id;

    expect((await req("GET", `/api/annotations/${id}`, "bob")).status).toBe(403);
    expect((await req("PATCH", `/api/annotations/${id}`, "bob", { body: "hijack" })).status).toBe(403);
    expect((await req("DELETE", `/api/annotations/${id}`, "bob")).status).toBe(403);
  });

  it("400s an empty-body edit and 404s unknown ids", async () => {
    const created = await req("POST", "/api/annotations", "alice", { type: "culture", id: "sumer", body: "n" });
    const id = created.body.annotation.id;
    expect((await req("PATCH", `/api/annotations/${id}`, "alice", { body: "   " })).status).toBe(400);
    expect((await req("GET", "/api/annotations/note_missing", "alice")).status).toBe(404);
    expect((await req("DELETE", "/api/annotations/note_missing", "alice")).status).toBe(404);
  });
});
