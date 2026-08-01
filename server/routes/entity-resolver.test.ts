import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the `/api/entity/*` resolver routes (US-009). Wired with
 * injectable in-memory fetchers (no storage/fs), asserting HTTP status + the
 * canonical descriptor for known/unknown ids and domains.
 */

import { registerEntityResolverRoutes, type EntityFetcher } from "./entity-resolver";

const fetchProfile: EntityFetcher = async (id) =>
  id === "minoan" ? { id, name: "Minoan Civilization", region: "Crete", year: -2000 } : null;
const fetchDeity: EntityFetcher = async (id) => (id === "zeus" ? { id, name: "Zeus" } : null);

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerEntityResolverRoutes(app, {
    fetchers: { "culture-profile": fetchProfile, deity: fetchDeity },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/entities", () => {
  it("lists the supported domains + the path template", async () => {
    const res = await fetch(`${baseUrl}/api/entities`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pathTemplate).toBe("/entity/:domain/:id");
    const domains = body.domains.map((d: { domain: string }) => d.domain);
    expect(domains).toContain("culture-profile");
    expect(domains).toContain("deity");
    const cp = body.domains.find((d: { domain: string }) => d.domain === "culture-profile");
    expect(cp.citable).toBe(true);
  });
});

describe("GET /api/entity/:domain/:id", () => {
  it("resolves a known entity with an absolute canonical URL", async () => {
    const res = await fetch(`${baseUrl}/api/entity/culture-profile/minoan`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Minoan Civilization");
    expect(body.entityType).toBe("culture");
    expect(body.stableId).toBe("cs:culture:minoan");
    expect(body.canonicalPath).toBe("/entity/culture-profile/minoan");
    expect(body.canonicalUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/entity\/culture-profile\/minoan$/);
    expect(body.citable).toBe(true);
    expect(body.viewPath).toBe("/culture-profile/minoan/report");
    expect(body.region).toBe("Crete");
    expect(body.year).toBe(-2000);
  });

  it("resolves a non-citable entity with a null view path", async () => {
    const res = await fetch(`${baseUrl}/api/entity/deity/zeus`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Zeus");
    expect(body.citable).toBe(true); // deity IS a citable domain
    expect(body.citationDomain).toBe("deities"); // plural citations segment, not "deity"
    expect(body.viewPath).toBeNull();
  });

  it("404s an unknown domain", async () => {
    const res = await fetch(`${baseUrl}/api/entity/dragons/smaug`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Unknown entity domain");
  });

  it("404s an unknown (or renamed) id gracefully", async () => {
    const res = await fetch(`${baseUrl}/api/entity/culture-profile/atlantis`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });
});
