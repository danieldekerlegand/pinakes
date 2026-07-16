import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CACHE_VERSION,
  APP_SHELL_CACHE,
  DATA_CACHE,
  RUNTIME_CACHE,
  MANAGED_CACHES,
  APP_SHELL_URLS,
  route,
  staleCacheNames,
} from "./cache-strategy";

const ORIGIN = "https://pinakes.test";
const ctx = { origin: ORIGIN };

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../../../public");

describe("route()", () => {
  it("bypasses non-GET requests (network-only)", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const plan = route({ url: `${ORIGIN}/api/collections`, method }, ctx);
      expect(plan).toEqual({ strategy: "network-only", cache: null });
    }
  });

  it("never caches Server-Sent-Events streams", () => {
    const plan = route(
      { url: `${ORIGIN}/api/stream`, headers: { accept: "text/event-stream" } },
      ctx,
    );
    expect(plan.strategy).toBe("network-only");
    expect(plan.cache).toBeNull();
  });

  it("uses network-first + data cache for same-origin /api GETs", () => {
    const plan = route({ url: `${ORIGIN}/api/languages`, method: "GET" }, ctx);
    expect(plan).toEqual({ strategy: "network-first", cache: DATA_CACHE });
  });

  it("uses network-first + shell cache for navigations", () => {
    const byMode = route({ url: `${ORIGIN}/explore`, mode: "navigate" }, ctx);
    expect(byMode).toEqual({ strategy: "network-first", cache: APP_SHELL_CACHE });

    const byAccept = route(
      { url: `${ORIGIN}/explore`, headers: { accept: "text/html,*/*" } },
      ctx,
    );
    expect(byAccept).toEqual({ strategy: "network-first", cache: APP_SHELL_CACHE });
  });

  it("uses cache-first + shell cache for same-origin static assets", () => {
    const plan = route({ url: `${ORIGIN}/assets/index-abc123.js` }, ctx);
    expect(plan).toEqual({ strategy: "cache-first", cache: APP_SHELL_CACHE });
  });

  it("uses stale-while-revalidate for allow-listed cross-origin hosts", () => {
    for (const url of [
      "https://fonts.gstatic.com/s/inter/x.woff2",
      "https://a.tile.openstreetmap.org/3/4/5.png",
      "https://basemaps.cartocdn.com/light/3/4/5.png",
    ]) {
      const plan = route({ url }, ctx);
      expect(plan).toEqual({
        strategy: "stale-while-revalidate",
        cache: RUNTIME_CACHE,
      });
    }
  });

  it("does not cache unknown cross-origin hosts", () => {
    const plan = route({ url: "https://evil.example.com/tracker.gif" }, ctx);
    expect(plan).toEqual({ strategy: "network-only", cache: null });
  });

  it("treats a subdomain of an allow-listed host as cacheable", () => {
    const plan = route({ url: "https://a.tiles.stadiamaps.com/1/2/3.png" }, ctx);
    expect(plan.strategy).toBe("stale-while-revalidate");
  });

  it("falls back to network-only when the url cannot be parsed", () => {
    // An invalid base origin makes `new URL` throw → defensive network-only.
    const plan = route({ url: "/api/languages" }, { origin: "not-a-valid-origin" });
    expect(plan.strategy).toBe("network-only");
  });
});

describe("staleCacheNames()", () => {
  it("returns only unmanaged pinakes caches", () => {
    const existing = [
      APP_SHELL_CACHE,
      DATA_CACHE,
      "pinakes-shell-v0",
      "pinakes-data-v0",
      "workbox-precache",
      "some-other-app-cache",
    ];
    expect(staleCacheNames(existing).sort()).toEqual(
      ["pinakes-data-v0", "pinakes-shell-v0"].sort(),
    );
  });

  it("returns empty when only managed caches exist", () => {
    expect(staleCacheNames(MANAGED_CACHES.slice())).toEqual([]);
  });
});

describe("constants", () => {
  it("derives every managed cache name from CACHE_VERSION", () => {
    for (const name of MANAGED_CACHES) {
      expect(name).toContain(CACHE_VERSION);
      expect(name.startsWith("pinakes-")).toBe(true);
    }
    expect(new Set(MANAGED_CACHES).size).toBe(MANAGED_CACHES.length);
  });
});

// Build checks: the shipped public assets exist and stay in sync with the module.
describe("shipped PWA assets", () => {
  it("manifest.webmanifest is valid and installable", () => {
    const raw = readFileSync(
      path.join(PUBLIC_DIR, "manifest.webmanifest"),
      "utf-8",
    );
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.type).toBeTruthy();
    }
    // Every manifest icon must exist on disk.
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ""));
      expect(() => readFileSync(file)).not.toThrow();
    }
    // A maskable icon is present for adaptive install surfaces.
    expect(
      manifest.icons.some((i: { purpose?: string }) =>
        (i.purpose ?? "").includes("maskable"),
      ),
    ).toBe(true);
  });

  it("sw.js exists and mirrors CACHE_VERSION + managed cache names", () => {
    const sw = readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf-8");
    expect(sw).toContain(`const CACHE_VERSION = "${CACHE_VERSION}"`);
    for (const name of MANAGED_CACHES) {
      // The SW builds names via template literal, so assert the literal suffix.
      const suffix = name.replace(`-${CACHE_VERSION}`, "");
      expect(sw).toContain(suffix);
    }
    // Registers the three lifecycle handlers.
    for (const evt of ["install", "activate", "fetch"]) {
      expect(sw).toContain(`addEventListener("${evt}"`);
    }
  });

  it("every precached app-shell url is a plausible path", () => {
    for (const url of APP_SHELL_URLS) {
      expect(url.startsWith("/")).toBe(true);
    }
  });
});
