import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the aggregated graph-health service (US-005). Both backend
 * `isAvailable()` probes are module-mocked — no live Neo4j, no live network — so
 * we can drive availability transitions (up → down → up) deterministically and
 * assert the aggregation + short-cache behaviour.
 */

const mocks = vi.hoisted(() => ({
  graphIsAvailable: vi.fn(),
  clientIsAvailable: vi.fn(),
}));

vi.mock("./graph-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph-store")>();
  return { ...actual, isAvailable: mocks.graphIsAvailable };
});

vi.mock("./engine-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./engine-client")>();
  return { ...actual, isAvailable: mocks.clientIsAvailable };
});

import { getGraphHealth, resetGraphHealthCache } from "./graph-health";

beforeEach(() => {
  mocks.graphIsAvailable.mockReset();
  mocks.clientIsAvailable.mockReset();
  resetGraphHealthCache();
  // Default TTL for cache tests; individual tests override as needed.
  delete process.env.GRAPH_HEALTH_TTL_MS;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.GRAPH_HEALTH_TTL_MS;
});

describe("getGraphHealth aggregation", () => {
  it("reports available when both backends are up", async () => {
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);
    const health = await getGraphHealth(true);
    expect(health).toMatchObject({ available: true, neo4j: true, sidecar: true });
    expect(typeof health.checkedAt).toBe("number");
  });

  it("reports available when only one backend is up", async () => {
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(true);
    expect(await getGraphHealth(true)).toMatchObject({
      available: true,
      neo4j: false,
      sidecar: true,
    });
  });

  it("reports unavailable only when both backends are down", async () => {
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(false);
    expect(await getGraphHealth(true)).toMatchObject({
      available: false,
      neo4j: false,
      sidecar: false,
    });
  });

  it("never throws when a probe rejects (treats it as down)", async () => {
    mocks.graphIsAvailable.mockRejectedValue(new Error("boom"));
    mocks.clientIsAvailable.mockResolvedValue(true);
    expect(await getGraphHealth(true)).toMatchObject({
      available: true,
      neo4j: false,
      sidecar: true,
    });
  });
});

describe("getGraphHealth transitions (up → down → up)", () => {
  it("re-probes after the cache is reset and reflects the new state", async () => {
    // Up
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);
    expect((await getGraphHealth(true)).available).toBe(true);

    // Down
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(false);
    resetGraphHealthCache();
    const down = await getGraphHealth();
    expect(down).toMatchObject({ available: false, neo4j: false, sidecar: false });

    // Back up
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);
    resetGraphHealthCache();
    expect((await getGraphHealth()).available).toBe(true);
  });
});

describe("getGraphHealth caching", () => {
  it("serves a cached verdict within the TTL without re-probing", async () => {
    process.env.GRAPH_HEALTH_TTL_MS = "60000";
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);

    await getGraphHealth(); // populates cache (1 probe each)
    await getGraphHealth(); // served from cache
    await getGraphHealth(); // served from cache

    expect(mocks.graphIsAvailable).toHaveBeenCalledTimes(1);
    expect(mocks.clientIsAvailable).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses the cache and re-probes", async () => {
    process.env.GRAPH_HEALTH_TTL_MS = "60000";
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);

    await getGraphHealth();
    await getGraphHealth(true);

    expect(mocks.graphIsAvailable).toHaveBeenCalledTimes(2);
    expect(mocks.clientIsAvailable).toHaveBeenCalledTimes(2);
  });

  it("re-probes once the TTL has elapsed", async () => {
    vi.useFakeTimers();
    process.env.GRAPH_HEALTH_TTL_MS = "5000";
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);

    await getGraphHealth(); // t=0, probe
    vi.advanceTimersByTime(2000);
    await getGraphHealth(); // cached
    expect(mocks.graphIsAvailable).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000); // now 6s > 5s TTL
    await getGraphHealth(); // re-probe
    expect(mocks.graphIsAvailable).toHaveBeenCalledTimes(2);
  });
});
