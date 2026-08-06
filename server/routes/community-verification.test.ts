import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * What is left of community verification & culture stewardship (US-012) on this
 * backend: nothing but the hand-off.
 *
 * The `/api/stewardship*` third went to Python in pinakes:61 US-2 and the
 * confirm/verification pair in pinakes:80 US-1; their behavioural coverage moved
 * with them to `services/api/tests/test_stewardship_routes.py` and
 * `services/api/tests/test_community_verification.py`. What this file asserts is
 * that all five paths are still *registered* — the parity baseline was harvested
 * from that set — and that each 501 names the right replacement, which is now
 * two different modules.
 *
 * The pure threshold logic is still specified here:
 * `server/services/community-verification.test.ts` is what says the two
 * implementations agree about dedup, the steward bar and the confidence ramp.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerCommunityVerificationRoutes,
} from "./community-verification";

let app: Express;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  app = express();
  app.use(express.json());
  registerCommunityVerificationRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Res = { status: number; body: any };
async function req(method: string, url: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("every route in this file is ported to the Python service", () => {
  const RETIRED: ReadonlyArray<readonly [string, string, string]> = [
    ["GET", "/api/stewardship?domain=roman-empire", PORTED_TO.stewardship],
    ["POST", "/api/stewardship/adopt", PORTED_TO.stewardship],
    ["POST", "/api/stewardship/release", PORTED_TO.stewardship],
    ["POST", "/api/contributions/c-1/confirm", PORTED_TO.verification],
    ["GET", "/api/contributions/c-1/verification", PORTED_TO.verification],
  ];

  it.each(RETIRED)(
    "%s %s answers 501 naming %s",
    async (method, url, servedBy) => {
      const res = await req(method, url, method === "GET" ? undefined : {});
      expect(res.status).toBe(501);
      expect(res.body.error).toBe(PORTED_ERROR);
      expect(res.body.servedBy).toBe(servedBy);
      expect(res.body.coverage).toBe("/api/_parity/coverage");
    },
  );

  it("keeps every retired path registered, and names two replacements", () => {
    // Deleting a registration would rewrite the parity baseline the port is
    // graded against. The two port units in one file are why `servedBy` is
    // per-route rather than a module constant: a caller told to look in
    // `stewardship.py` for the confirm flow would find nothing there.
    const registered = [...PORTED_ROUTES.get, ...PORTED_ROUTES.post];
    expect(registered.map(([route]) => route).sort()).toEqual([
      "/api/contributions/:id/confirm",
      "/api/contributions/:id/verification",
      "/api/stewardship",
      "/api/stewardship/adopt",
      "/api/stewardship/release",
    ]);
    expect(new Set(registered.map(([, target]) => target))).toEqual(
      new Set([PORTED_TO.stewardship, PORTED_TO.verification]),
    );
  });

  it("registers no handler that reads a store", async () => {
    // The whole file is stateless now — `registerCommunityVerificationRoutes`
    // takes no options, because there is nothing left to inject. A confirm that
    // still touched `data/runtime/contributions` from this process would be a
    // second writer of a queue the Python service now owns.
    const before = await req("POST", "/api/contributions/c-1/confirm", {
      reviewer: "Alice",
    });
    const after = await req("POST", "/api/contributions/c-1/confirm", {
      reviewer: "Alice",
    });
    expect(before.body).toEqual(after.body);
  });
});
