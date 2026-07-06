import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  validateChangelogInput,
  makeChangelogEntry,
  withinDateRange,
  sortChangelogNewestFirst,
  filterChangelog,
  paginateChangelog,
  computeChangelogStats,
  ChangelogStore,
  type ChangelogEntry,
  type ChangelogEntryInput,
} from "./changelog";

function entry(over: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: over.id ?? "change-1",
    timestamp: over.timestamp ?? "2026-07-01T00:00:00.000Z",
    domain: over.domain ?? "civilization",
    changeType: over.changeType ?? "added",
    source: over.source ?? "ai-review",
    ...over,
  };
}

describe("validateChangelogInput", () => {
  it("accepts a well-formed input", () => {
    const r = validateChangelogInput({ domain: "language", changeType: "added", source: "contribution" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("requires domain, changeType, and source", () => {
    const r = validateChangelogInput({} as Partial<ChangelogEntryInput>);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("domain is required");
    expect(r.errors).toContain("source is required");
    expect(r.errors.some((e) => e.startsWith("changeType must be"))).toBe(true);
  });

  it("rejects an invalid changeType", () => {
    const r = validateChangelogInput({ domain: "d", changeType: "bogus" as never, source: "s" });
    expect(r.valid).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    const r = validateChangelogInput({ domain: "d", changeType: "added", source: "s", confidence: 200 });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("confidence must be a number between 1 and 100");
  });
});

describe("makeChangelogEntry", () => {
  it("stamps id + timestamp and trims strings", () => {
    const e = makeChangelogEntry(
      { domain: "  civilization ", changeType: "added", source: " ai-review " },
      "change-x",
      "2026-07-06T12:00:00.000Z",
    );
    expect(e).toMatchObject({
      id: "change-x",
      timestamp: "2026-07-06T12:00:00.000Z",
      domain: "civilization",
      source: "ai-review",
      changeType: "added",
    });
  });

  it("drops empty optional fields and normalizes fields[]", () => {
    const e = makeChangelogEntry(
      {
        domain: "language",
        changeType: "modified",
        source: "contribution",
        targetFile: "  ",
        entityName: "",
        fields: ["name", " ", "region"],
      },
      "id1",
      "2026-07-06T00:00:00.000Z",
    );
    expect(e.targetFile).toBeUndefined();
    expect(e.entityName).toBeUndefined();
    expect(e.fields).toEqual(["name", "region"]);
  });
});

describe("withinDateRange", () => {
  it("is inclusive of the from bound", () => {
    expect(withinDateRange("2026-07-01T00:00:00.000Z", "2026-07-01", undefined)).toBe(true);
    expect(withinDateRange("2026-06-30T23:59:59.000Z", "2026-07-01", undefined)).toBe(false);
  });

  it("treats a date-only to bound as end of day (inclusive)", () => {
    expect(withinDateRange("2026-07-05T23:00:00.000Z", undefined, "2026-07-05")).toBe(true);
    expect(withinDateRange("2026-07-06T00:00:00.000Z", undefined, "2026-07-05")).toBe(false);
  });

  it("returns false for an unparseable timestamp", () => {
    expect(withinDateRange("not-a-date", "2026-01-01", "2026-12-31")).toBe(false);
  });
});

describe("sortChangelogNewestFirst", () => {
  it("orders by timestamp descending", () => {
    const sorted = sortChangelogNewestFirst([
      entry({ id: "a", timestamp: "2026-07-01T00:00:00.000Z" }),
      entry({ id: "b", timestamp: "2026-07-03T00:00:00.000Z" }),
      entry({ id: "c", timestamp: "2026-07-02T00:00:00.000Z" }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
});

describe("filterChangelog", () => {
  const entries = [
    entry({ id: "1", domain: "civilization", changeType: "added", source: "ai-review", timestamp: "2026-07-01T00:00:00.000Z" }),
    entry({ id: "2", domain: "language", changeType: "modified", source: "contribution", timestamp: "2026-07-03T00:00:00.000Z" }),
    entry({ id: "3", domain: "civilization", changeType: "removed", source: "contribution", timestamp: "2026-07-05T00:00:00.000Z" }),
  ];

  it("filters by domain", () => {
    expect(filterChangelog(entries, { domain: "civilization" }).map((e) => e.id)).toEqual(["3", "1"]);
  });

  it("filters by changeType", () => {
    expect(filterChangelog(entries, { changeType: "modified" }).map((e) => e.id)).toEqual(["2"]);
  });

  it("filters by source", () => {
    expect(filterChangelog(entries, { source: "contribution" }).map((e) => e.id)).toEqual(["3", "2"]);
  });

  it("filters by date range and returns newest-first", () => {
    const out = filterChangelog(entries, { from: "2026-07-02", to: "2026-07-05" });
    expect(out.map((e) => e.id)).toEqual(["3", "2"]);
  });
});

describe("paginateChangelog", () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry({ id: String(i) }));
  it("slices by offset + limit", () => {
    expect(paginateChangelog(entries, { offset: 1, limit: 2 }).map((e) => e.id)).toEqual(["1", "2"]);
  });
  it("defaults to a limit of 50", () => {
    expect(paginateChangelog(entries).length).toBe(5);
  });
});

describe("computeChangelogStats", () => {
  it("aggregates counts and date bounds", () => {
    const stats = computeChangelogStats([
      entry({ id: "1", domain: "civilization", changeType: "added", source: "ai-review", timestamp: "2026-07-01T00:00:00.000Z" }),
      entry({ id: "2", domain: "civilization", changeType: "modified", source: "contribution", timestamp: "2026-07-05T00:00:00.000Z" }),
      entry({ id: "3", domain: "language", changeType: "added", source: "ai-review", timestamp: "2026-07-03T00:00:00.000Z" }),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.byDomain).toEqual({ civilization: 2, language: 1 });
    expect(stats.byChangeType).toEqual({ added: 2, modified: 1, removed: 0 });
    expect(stats.bySource).toEqual({ "ai-review": 2, contribution: 1 });
    expect(stats.firstAt).toBe("2026-07-01T00:00:00.000Z");
    expect(stats.lastAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("returns null date bounds for an empty set", () => {
    const stats = computeChangelogStats([]);
    expect(stats.total).toBe(0);
    expect(stats.firstAt).toBeNull();
    expect(stats.lastAt).toBeNull();
  });
});

describe("ChangelogStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-store-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records an entry, persists it to disk, and reads it back", () => {
    const store = new ChangelogStore(dir);
    const rec = store.record(
      { domain: "civilization", changeType: "added", source: "ai-review", targetId: "sparta" },
      { id: "change-abc", now: "2026-07-06T00:00:00.000Z" },
    );
    expect(rec.id).toBe("change-abc");
    expect(fs.existsSync(path.join(dir, "change-abc.json"))).toBe(true);

    const fresh = new ChangelogStore(dir);
    const { entries, total } = fresh.list();
    expect(total).toBe(1);
    expect(entries[0].targetId).toBe("sparta");
  });

  it("throws on an invalid input", () => {
    const store = new ChangelogStore(dir);
    expect(() => store.record({ changeType: "added", source: "s" } as never)).toThrow(/Invalid changelog/);
  });

  it("lists filtered + paginated and computes stats", () => {
    const store = new ChangelogStore(dir);
    store.record({ domain: "civilization", changeType: "added", source: "ai-review" }, { id: "c1", now: "2026-07-01T00:00:00.000Z" });
    store.record({ domain: "language", changeType: "modified", source: "contribution" }, { id: "c2", now: "2026-07-03T00:00:00.000Z" });
    store.record({ domain: "civilization", changeType: "removed", source: "contribution" }, { id: "c3", now: "2026-07-05T00:00:00.000Z" });

    const civ = store.list({ domain: "civilization" });
    expect(civ.total).toBe(2);
    expect(civ.entries.map((e) => e.id)).toEqual(["c3", "c1"]);

    const paged = store.list({ limit: 1 });
    expect(paged.total).toBe(3);
    expect(paged.entries).toHaveLength(1);
    expect(paged.entries[0].id).toBe("c3"); // newest first

    const stats = store.stats({ source: "contribution" });
    expect(stats.total).toBe(2);
    expect(stats.byDomain).toEqual({ language: 1, civilization: 1 });
  });
});
