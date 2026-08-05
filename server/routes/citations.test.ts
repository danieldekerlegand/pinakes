import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * What is left of the `/api/citations/*` routes on this backend
 * (pinakes:61 US-2).
 *
 * The download — formats, headers, the rendered document, the three refusals —
 * is served by the Python service now, and its coverage moved with it to
 * `services/api/tests/test_citation_routes.py`. What this file asserts is the
 * split: the detail route is retired to 501 naming its replacement, and the
 * **index keeps answering**, because `contracts/parity/parity.test.ts` replays
 * `get-citations-index` against this app.
 *
 * `server/services/citation-export.ts` is still unit-tested next door — it is
 * the specification the port was read off, and
 * `services/api/tests/test_citation_export.py` is that same suite case for
 * case, which is what says the two agree on every rendered byte.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerCitationRoutes,
  type CitationFetcher,
} from "./citations";
import { type CitableEntity } from "../services/citation-export";

const minoan: CitableEntity = {
  entityType: "culture-profile",
  id: "minoan",
  name: "Minoan Civilization",
  sources: ["Evans 1921", "Archaeological evidence"],
  year: -2000,
  region: "Crete",
};

const fetchProfile: CitationFetcher = async (id) => (id === "minoan" ? minoan : null);
let fetched: string[] = [];

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerCitationRoutes(app, {
    fetchers: {
      "culture-profiles": {
        urlPath: "culture-profile",
        fetch: async (id) => {
          fetched.push(id);
          return fetchProfile(id);
        },
      },
    },
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

describe("GET /api/citations — still served here", () => {
  it("lists the configured domains + formats", async () => {
    // The recorded fixture `get-citations-index` is replayed against this app;
    // a baseline that stops reproducing its own recording is no longer a
    // baseline, which is why this one route did not retire with the other.
    const res = await fetch(`${baseUrl}/api/citations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domains).toEqual(["culture-profiles"]);
    expect(body.formats).toEqual(["bibtex", "ris", "csljson"]);
  });
});

describe("GET /api/citations/:domain/:id — ported to the Python service", () => {
  it("answers 501 naming its replacement", async () => {
    const res = await fetch(`${baseUrl}/api/citations/culture-profiles/minoan`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 for an unknown domain too, rather than 404ing first", async () => {
    // The retired handler is a stub: it does not know which domains exist, and
    // it must not — deciding that is the ported route's job now.
    const res = await fetch(`${baseUrl}/api/citations/dragons/smaug`);
    expect(res.status).toBe(501);
  });

  it("never reaches a fetcher", async () => {
    fetched = [];
    await fetch(`${baseUrl}/api/citations/culture-profiles/minoan?format=ris`);
    expect(fetched).toEqual([]);
  });

  it("keeps the retired path registered", () => {
    // Deleting the registration would rewrite the parity baseline the port is
    // graded against — and `/api/citations` is deliberately NOT in this list.
    expect(PORTED_ROUTES.get).toEqual(["/api/citations/:domain/:id"]);
  });
});
