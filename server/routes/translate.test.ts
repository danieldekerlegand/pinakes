import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the server-side translation proxy `POST /api/translate`
 * (US-002). The Google Translate boundary (`TranslateDeps`) is served from a fake
 * (no live network call) and the key is injected — no real `GOOGLE_TRANSLATE_API_KEY`.
 */

import { registerTranslateRoutes } from "./translate";
import { TranslateError, type TranslateDeps } from "../services/translate";

/** Fake deps: echoes a deterministic translation, asserts the server-side key is passed. */
const fakeDeps: TranslateDeps = {
  async translate(input, apiKey) {
    if (apiKey !== "server-side-test-key") {
      throw new Error("route did not pass the server-side key to deps");
    }
    return `${input.text}::${input.to}${input.from ? `<-${input.from}` : ""}`;
  },
};

const explodingDeps: TranslateDeps = {
  async translate() {
    throw new TranslateError("boom (simulated upstream failure)");
  },
};

function startApp(opts: { deps: TranslateDeps; apiKey: string | null }): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app: Express = express();
  app.use(express.json());
  registerTranslateRoutes(app, opts);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

type Res = { status: number; body: any };
async function post(baseUrl: string, body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/translate", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startApp({ deps: fakeDeps, apiKey: "server-side-test-key" }));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("translates using the server-side key (never a client key)", async () => {
    const { status, body } = await post(baseUrl, { text: "casa", from: "es", to: "en" });
    expect(status).toBe(200);
    expect(body.source).toBe("google-translate");
    expect(body.to).toBe("en");
    expect(body.from).toBe("es");
    expect(body.translation).toBe("casa::en<-es");
  });

  it("allows omitting the source language (auto-detect)", async () => {
    const { status, body } = await post(baseUrl, { text: "hola", to: "en" });
    expect(status).toBe(200);
    expect(body.from).toBeNull();
    expect(body.translation).toBe("hola::en");
  });

  it("never echoes an API key in the response", async () => {
    const { body } = await post(baseUrl, { text: "hola", to: "en" });
    expect(JSON.stringify(body)).not.toContain("server-side-test-key");
  });

  it("rejects a missing/blank text with 400", async () => {
    expect((await post(baseUrl, { to: "en" })).status).toBe(400);
    expect((await post(baseUrl, { text: "   ", to: "en" })).status).toBe(400);
  });

  it("rejects a missing target language with 400", async () => {
    expect((await post(baseUrl, { text: "hola" })).status).toBe(400);
  });
});

describe("POST /api/translate — no server-side key", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startApp({ deps: fakeDeps, apiKey: null }));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 503 when translation is not configured", async () => {
    const { status } = await post(baseUrl, { text: "hola", to: "en" });
    expect(status).toBe(503);
  });
});

describe("POST /api/translate — upstream failure", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startApp({ deps: explodingDeps, apiKey: "server-side-test-key" }));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("maps an upstream failure to 502", async () => {
    const { status } = await post(baseUrl, { text: "hola", to: "en" });
    expect(status).toBe(502);
  });
});
