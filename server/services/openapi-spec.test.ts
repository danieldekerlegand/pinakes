import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildOpenApiSpec } from "./openapi-spec";

describe("buildOpenApiSpec", () => {
  it("is a valid OpenAPI 3 doc covering the contribution surface", () => {
    const spec = buildOpenApiSpec() as any;
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.paths["/api/contributions"]).toBeTruthy();
    expect(spec.paths["/api/contributions/{id}/review"].patch).toBeTruthy();
    expect(spec.paths["/api/openapi.json"]).toBeTruthy();
    // Writes are secured, reads are open.
    expect(spec.paths["/api/contributions"].post.security.length).toBeGreaterThan(0);
    expect(spec.paths["/api/contributions"].get.security).toEqual([]);
  });

  it("matches the committed docs/openapi.json snapshot", () => {
    const snapshotPath = path.resolve(import.meta.dirname, "../../docs/openapi.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    expect(snapshot).toEqual(buildOpenApiSpec());
  });
});
