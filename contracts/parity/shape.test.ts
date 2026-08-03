import { describe, expect, it } from "vitest";

import {
  describeShape,
  formatShape,
  matchShape,
  mergeShapes,
  truncateSample,
  type TypeShape,
} from "./shape";
import { replayFixture, type ParityFixture } from "./harness";

describe("describeShape", () => {
  it("reduces a body to its structure", () => {
    expect(describeShape({ id: "a", count: 2, ok: true })).toEqual({
      kind: "object",
      properties: { id: { kind: "string" }, count: { kind: "number" }, ok: { kind: "boolean" } },
    });
  });

  it("merges heterogeneous array items, marking sometimes-present keys optional", () => {
    const shape = describeShape([{ id: "a", note: "x" }, { id: "b" }]);
    expect(shape).toEqual({
      kind: "array",
      items: {
        kind: "object",
        properties: { id: { kind: "string" }, note: { kind: "string" } },
        optional: ["note"],
      },
    });
  });

  it("describes an empty array without inventing an item type", () => {
    expect(describeShape([])).toEqual({ kind: "array", items: null });
  });

  it("unions a nullable field", () => {
    const shape = describeShape([{ iso: "zh" }, { iso: null }]) as {
      items: { properties: Record<string, TypeShape> };
    };
    expect(shape.items.properties.iso).toEqual({
      kind: "union",
      of: [{ kind: "string" }, { kind: "null" }],
    });
  });
});

describe("mergeShapes", () => {
  it("is a no-op against unknown", () => {
    expect(mergeShapes({ kind: "unknown" }, { kind: "string" })).toEqual({ kind: "string" });
  });

  it("keeps an array's item shape when the other side is empty", () => {
    expect(mergeShapes({ kind: "array", items: null }, { kind: "array", items: { kind: "number" } })).toEqual({
      kind: "array",
      items: { kind: "number" },
    });
  });
});

describe("matchShape", () => {
  const baseline = describeShape({
    total: 3,
    results: [{ id: "a", name: "A" }],
  });

  it("passes an identical body", () => {
    expect(matchShape(baseline, { total: 1, results: [{ id: "b", name: "B" }] })).toEqual([]);
  });

  it("passes when the candidate adds properties (a port may return more)", () => {
    const result = matchShape(baseline, {
      total: 1,
      results: [{ id: "b", name: "B", extra: true }],
      page: 1,
    });
    expect(result).toEqual([]);
  });

  it("fails on a missing property the baseline always carried", () => {
    const result = matchShape(baseline, { total: 1, results: [{ id: "b" }] });
    expect(result).toEqual([
      { path: "$.results[0].name", expected: "string", actual: "missing", severity: "error" },
    ]);
  });

  it("fails on a changed primitive type", () => {
    const result = matchShape(baseline, { total: "1", results: [] });
    expect(result).toEqual([{ path: "$.total", expected: "number", actual: "string", severity: "error" }]);
  });

  it("tolerates an empty array by default and flags it when asked", () => {
    expect(matchShape(baseline, { total: 0, results: [] })).toEqual([]);
    const strict = matchShape(baseline, { total: 0, results: [] }, { requireNonEmptyArrays: true });
    expect(strict).toHaveLength(1);
    expect(strict[0].path).toBe("$.results");
  });

  it("allows an optional property to be absent", () => {
    const shape = describeShape([{ id: "a", note: "x" }, { id: "b" }]);
    expect(matchShape(shape, [{ id: "c" }])).toEqual([]);
  });

  it("accepts anything where the baseline recorded null", () => {
    const shape = describeShape({ maybe: null });
    expect(matchShape(shape, { maybe: { deep: 1 } })).toEqual([]);
  });

  it("reports extra properties as info only when asked", () => {
    const shape = describeShape({ id: "a" });
    const result = matchShape(shape, { id: "b", added: 1 }, { reportExtraProperties: true });
    expect(result).toEqual([
      { path: "$.added", expected: "absent in baseline", actual: "number", severity: "info" },
    ]);
  });

  it("satisfies a union when any branch matches", () => {
    const shape = describeShape([{ iso: "zh" }, { iso: null }]);
    expect(matchShape(shape, [{ iso: "en" }, { iso: null }])).toEqual([]);
    expect(matchShape(shape, [{ iso: 7 }])).toHaveLength(1);
  });
});

describe("formatShape", () => {
  it("summarizes a shape for a mismatch report", () => {
    expect(formatShape(describeShape([{ id: "a", name: "b" }]))).toBe("array<object{id, name}>");
  });
});

describe("truncateSample", () => {
  it("caps arrays and long strings", () => {
    const sample = truncateSample({ rows: [1, 2, 3, 4], text: "x".repeat(300) }) as {
      rows: unknown[];
      text: string;
    };
    expect(sample.rows).toEqual([1, 2, "…2 more"]);
    expect(sample.text.endsWith("…")).toBe(true);
    expect(sample.text).toHaveLength(201);
  });
});

describe("replayFixture", () => {
  const fixture: ParityFixture = {
    id: "example",
    description: "example",
    request: { method: "GET", path: "/api/example", route: "/api/example" },
    response: {
      status: 200,
      contentType: "application/json",
      shape: describeShape({ items: [{ id: "a" }] }),
      sample: { items: [{ id: "a" }] },
    },
  };

  it("passes a handler that answers the recorded shape", async () => {
    const result = await replayFixture(fixture, async () => ({
      status: 200,
      contentType: "application/json",
      body: { items: [{ id: "z" }] },
    }));
    expect(result.ok).toBe(true);
  });

  it("fails on a status difference without comparing the body", async () => {
    const result = await replayFixture(fixture, async () => ({
      status: 501,
      contentType: "application/json",
      body: { detail: "not ported" },
    }));
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { path: "$status", expected: "200", actual: "501", severity: "error" },
    ]);
  });

  it("reports an unreachable handler instead of throwing", async () => {
    const result = await replayFixture(fixture, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("forwards the recorded body and headers to the handler", async () => {
    const posted: unknown[] = [];
    await replayFixture(
      {
        ...fixture,
        request: {
          method: "POST",
          path: "/api/example",
          route: "/api/example",
          body: { a: 1 },
          headers: { "X-Owner-Id": "tester" },
        },
      },
      async (request) => {
        posted.push(request);
        return { status: 200, contentType: "application/json", body: { items: [{ id: "a" }] } };
      },
    );
    expect(posted).toEqual([
      expect.objectContaining({ method: "POST", body: { a: 1 }, headers: { "X-Owner-Id": "tester" } }),
    ]);
  });
});
