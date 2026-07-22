import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * The registry publisher is best-effort by contract (KCB §3: the registry is a
 * cache/index, a provider's own manifest is authoritative). These tests pin that
 * contract — every failure mode resolves rather than throws, and `servingDirectly`
 * stays true so the capabilities are never reported as down with the registry.
 */
import {
  DEFAULT_REGISTRY_TIMEOUT_MS,
  configuredOrigin,
  publishCapabilityManifest,
} from "./capability-registry";

const ENV_KEYS = ["KCB_REGISTRY_URL", "KCB_REGISTRY_TIMEOUT_MS", "PINAKES_PUBLIC_ORIGIN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("publishCapabilityManifest", () => {
  it("is a no-op when no registry is configured, and says so", async () => {
    const result = await publishCapabilityManifest({ fetchImpl: () => Promise.reject(new Error("no")) });
    expect(result.registered).toBe(false);
    expect(result.registryUrl).toBeNull();
    expect(result.servingDirectly).toBe(true);
    expect(result.detail).toMatch(/No KCB_REGISTRY_URL/);
  });

  it("posts the origin-absolutized manifest to the registry", async () => {
    let seenUrl = "";
    let posted: { identity: string; endpoints: { manifest: string } } | null = null;
    const result = await publishCapabilityManifest({
      registryUrl: "https://registry.example/",
      origin: "https://pinakes.example",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seenUrl = url;
        posted = JSON.parse(String(init.body));
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(seenUrl).toBe("https://registry.example/manifests");
    expect(posted!.identity).toBe("pinakes:agent:resolver");
    expect(posted!.endpoints.manifest).toBe(
      "https://pinakes.example/.well-known/kcb-manifest.json",
    );
    expect(result.registered).toBe(true);
  });

  it("reads the registry + origin from the environment", async () => {
    process.env.KCB_REGISTRY_URL = "https://env-registry.example//";
    process.env.PINAKES_PUBLIC_ORIGIN = "https://env-pinakes.example/";
    let seenUrl = "";
    const result = await publishCapabilityManifest({
      fetchImpl: (async (url: string) => {
        seenUrl = url;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(configuredOrigin()).toBe("https://env-pinakes.example");
    expect(seenUrl).toBe("https://env-registry.example/manifests");
    expect(result.registered).toBe(true);
  });

  it("reports an unreachable registry without throwing, still serving directly", async () => {
    const result = await publishCapabilityManifest({
      registryUrl: "https://registry.example",
      fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });
    expect(result.registered).toBe(false);
    expect(result.servingDirectly).toBe(true);
    expect(result.detail).toMatch(/ECONNREFUSED/);
    expect(result.detail).toMatch(/invocable directly/);
  });

  it("reports a rejecting registry without throwing", async () => {
    const result = await publishCapabilityManifest({
      registryUrl: "https://registry.example",
      fetchImpl: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
    });
    expect(result.registered).toBe(false);
    expect(result.servingDirectly).toBe(true);
    expect(result.detail).toMatch(/HTTP 403/);
  });

  it("aborts a hanging registry on the configured timeout", async () => {
    const result = await publishCapabilityManifest({
      registryUrl: "https://registry.example",
      timeoutMs: 10,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    });
    expect(result.registered).toBe(false);
    expect(result.servingDirectly).toBe(true);
    expect(DEFAULT_REGISTRY_TIMEOUT_MS).toBe(5_000);
  });
});
