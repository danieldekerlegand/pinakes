import { describe, it, expect } from "vitest";
import {
  isGraphFeatureEnabled,
  graphUnavailableReason,
  UNKNOWN_GRAPH_STATUS,
  type GraphStatus,
} from "./availability";

const bothUp: GraphStatus = { available: true, neo4j: true, sidecar: true };
const bothDown: GraphStatus = { available: false, neo4j: false, sidecar: false };
const onlySidecar: GraphStatus = { available: true, neo4j: false, sidecar: true };
const onlyNeo4j: GraphStatus = { available: true, neo4j: true, sidecar: false };

describe("isGraphFeatureEnabled", () => {
  it("fails closed for a null/undefined status", () => {
    expect(isGraphFeatureEnabled(null)).toBe(false);
    expect(isGraphFeatureEnabled(undefined, "neo4j")).toBe(false);
    expect(isGraphFeatureEnabled(UNKNOWN_GRAPH_STATUS)).toBe(false);
  });

  it("gates on the requested backend", () => {
    expect(isGraphFeatureEnabled(onlySidecar, "sidecar")).toBe(true);
    expect(isGraphFeatureEnabled(onlySidecar, "neo4j")).toBe(false);
    expect(isGraphFeatureEnabled(onlyNeo4j, "neo4j")).toBe(true);
    expect(isGraphFeatureEnabled(onlyNeo4j, "sidecar")).toBe(false);
  });

  it("'any' is enabled when either backend is up", () => {
    expect(isGraphFeatureEnabled(onlySidecar, "any")).toBe(true);
    expect(isGraphFeatureEnabled(onlyNeo4j)).toBe(true);
    expect(isGraphFeatureEnabled(bothDown, "any")).toBe(false);
  });

  it("tracks an up → down → up transition", () => {
    expect(isGraphFeatureEnabled(bothUp)).toBe(true);
    expect(isGraphFeatureEnabled(bothDown)).toBe(false);
    expect(isGraphFeatureEnabled(bothUp)).toBe(true);
  });
});

describe("graphUnavailableReason", () => {
  it("returns null when the feature is available (nothing to explain)", () => {
    expect(graphUnavailableReason(bothUp)).toBeNull();
    expect(graphUnavailableReason(onlySidecar, "sidecar")).toBeNull();
    expect(graphUnavailableReason(onlyNeo4j, "neo4j")).toBeNull();
  });

  it("returns a backend-specific message when unavailable", () => {
    expect(graphUnavailableReason(bothDown, "neo4j")).toMatch(/database is offline/i);
    expect(graphUnavailableReason(bothDown, "sidecar")).toMatch(/service is offline/i);
    expect(graphUnavailableReason(bothDown, "any")).toMatch(/shared graph is offline/i);
    expect(graphUnavailableReason(null)).toMatch(/offline/i);
  });
});
