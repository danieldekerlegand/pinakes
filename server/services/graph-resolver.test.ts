import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  createGraphResolver,
  loadAliasEntries,
  getGraphResolver,
  resetGraphResolver,
  mintCsid,
  nameSimilarity,
  type AliasEntry,
  type AmbiguityEvent,
} from "./graph-resolver";

// ── Fixtures ─────────────────────────────────────────────────────────────

const ENTRIES: AliasEntry[] = [
  { csid: "cs:language:lat", pinakesId: "lat", nodeType: "language", name: "Latin", region: "Italy" },
  { csid: "cs:language:grc", pinakesId: "grc", nodeType: "language", name: "Ancient Greek", region: "Greece" },
  { csid: "cs:language:san", pinakesId: "san", nodeType: "language", name: "Sanskrit", region: "India" },
  { csid: "cs:culture:rome", pinakesId: "rome", nodeType: "culture", name: "Roman", region: "Italy" },
  // Same normalized name in two different regions → region disambiguates.
  { csid: "cs:culture:norse-scand", pinakesId: "norse-scand", nodeType: "culture", name: "Norse", region: "Scandinavia" },
  { csid: "cs:culture:norse-iceland", pinakesId: "norse-iceland", nodeType: "culture", name: "Norse", region: "Iceland" },
];

describe("graph-resolver — alias resolution", () => {
  it("resolves an exact (type, id) hit with confidence 1.0", () => {
    const resolver = createGraphResolver(ENTRIES);
    expect(resolver.resolve({ type: "language", id: "lat" })).toEqual({
      csid: "cs:language:lat",
      confidence: 1,
      method: "alias",
    });
  });

  it("honors an explicit csid/alias column over the minted value", () => {
    const resolver = createGraphResolver([
      { csid: "cs:language:xyz-merged", pinakesId: "lat", nodeType: "language", name: "Latin" },
    ]);
    const resolved = resolver.resolve({ type: "language", id: "lat" });
    expect(resolved?.csid).toBe("cs:language:xyz-merged");
    expect(resolved?.method).toBe("alias");
    // The deterministic mint is *not* what got indexed.
    expect(mintCsid("language", "lat")).toBe("cs:language:lat");
  });

  it("returns null for an unknown id with no fuzzy signal", () => {
    const resolver = createGraphResolver(ENTRIES);
    expect(resolver.resolve({ type: "language", id: "unknown-id" })).toBeNull();
  });

  it("does not treat duplicate rows that share one csid as ambiguous", () => {
    const onAmbiguous = vi.fn();
    // Same id/type appears twice (as in the live corpus) but collapses to one csid.
    const resolver = createGraphResolver(
      [
        { csid: "cs:place:mohenjo-daro", pinakesId: "mohenjo-daro", nodeType: "place", name: "Mohenjo-daro" },
        { csid: "cs:place:mohenjo-daro", pinakesId: "mohenjo-daro", nodeType: "place", name: "Mohenjo-daro" },
      ],
      { onAmbiguous },
    );
    expect(resolver.resolve({ type: "place", id: "mohenjo-daro" })).toEqual({
      csid: "cs:place:mohenjo-daro",
      confidence: 1,
      method: "alias",
    });
    expect(onAmbiguous).not.toHaveBeenCalled();
  });

  it("logs and returns null when one (type, id) maps to two distinct csids", () => {
    const events: AmbiguityEvent[] = [];
    const resolver = createGraphResolver(
      [
        { csid: "cs:place:mohenjo-a", pinakesId: "mohenjo", nodeType: "place", name: "Mohenjo A" },
        { csid: "cs:place:mohenjo-b", pinakesId: "mohenjo", nodeType: "place", name: "Mohenjo B" },
      ],
      { onAmbiguous: (e) => events.push(e) },
    );
    expect(resolver.resolve({ type: "place", id: "mohenjo" })).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0].method).toBe("alias");
    expect(events[0].candidates.map((c) => c.csid).sort()).toEqual([
      "cs:place:mohenjo-a",
      "cs:place:mohenjo-b",
    ]);
  });
});

describe("graph-resolver — fuzzy fallback", () => {
  it("falls back to a fuzzy name match when no id is given", () => {
    const resolver = createGraphResolver(ENTRIES);
    const resolved = resolver.resolve({ type: "language", name: "Latin" });
    expect(resolved?.csid).toBe("cs:language:lat");
    expect(resolved?.method).toBe("fuzzy");
    expect(resolved?.confidence).toBe(1);
  });

  it("tolerates minor spelling variation above the threshold", () => {
    const resolver = createGraphResolver(ENTRIES);
    const resolved = resolver.resolve({ type: "language", name: "Sanskrt" });
    expect(resolved?.csid).toBe("cs:language:san");
    expect(resolved?.method).toBe("fuzzy");
    expect(resolved?.confidence).toBeGreaterThan(0.6);
    expect(resolved?.confidence).toBeLessThan(1);
  });

  it("returns null below the similarity threshold (no match)", () => {
    const resolver = createGraphResolver(ENTRIES);
    expect(resolver.resolve({ type: "language", name: "Klingon" })).toBeNull();
  });

  it("uses region to disambiguate two same-named candidates", () => {
    const resolver = createGraphResolver(ENTRIES);
    expect(resolver.resolve({ type: "culture", name: "Norse", region: "Iceland" })?.csid).toBe(
      "cs:culture:norse-iceland",
    );
    expect(resolver.resolve({ type: "culture", name: "Norse", region: "Scandinavia" })?.csid).toBe(
      "cs:culture:norse-scand",
    );
  });

  it("logs and returns null when two distinct csids tie for the best fuzzy score", () => {
    const events: AmbiguityEvent[] = [];
    const resolver = createGraphResolver(ENTRIES, { onAmbiguous: (e) => events.push(e) });
    // "Norse" matches both norse-* entries exactly and no region is given.
    expect(resolver.resolve({ type: "culture", name: "Norse" })).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0].method).toBe("fuzzy");
    expect(events[0].candidates.map((c) => c.csid).sort()).toEqual([
      "cs:culture:norse-iceland",
      "cs:culture:norse-scand",
    ]);
  });

  it("does not fuzzy-match across node types", () => {
    const resolver = createGraphResolver(ENTRIES);
    // "Roman" is a culture; asking within `language` finds nothing.
    expect(resolver.resolve({ type: "language", name: "Roman" })).toBeNull();
  });

  it("prefers an exact alias hit over a fuzzy candidate", () => {
    const resolver = createGraphResolver(ENTRIES);
    // id resolves directly even though the name would fuzzy-match elsewhere.
    const resolved = resolver.resolve({ type: "language", id: "grc", name: "Latin" });
    expect(resolved).toEqual({ csid: "cs:language:grc", confidence: 1, method: "alias" });
  });
});

describe("graph-resolver — reverse lookup", () => {
  it("reverses a known csid to its entity ref", () => {
    const resolver = createGraphResolver(ENTRIES);
    expect(resolver.reverse("cs:language:lat")).toEqual({
      type: "language",
      id: "lat",
      name: "Latin",
      region: "Italy",
    });
  });

  it("returns null for an unknown csid", () => {
    const resolver = createGraphResolver(ENTRIES);
    expect(resolver.reverse("cs:language:nope")).toBeNull();
  });
});

describe("nameSimilarity", () => {
  it("scores identical strings 1 and disjoint strings 0", () => {
    expect(nameSimilarity("latin", "latin")).toBe(1);
    expect(nameSimilarity("latin", "zzzz")).toBe(0);
    expect(nameSimilarity("", "")).toBe(0);
  });
});

describe("graph-resolver — lexicon-backed loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetGraphResolver();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-resolver-"));
    // Minimal `languages.tsv` mapped to the `language` node type (id/name columns).
    fs.writeFileSync(
      path.join(tmpDir, "languages.tsv"),
      ["id\tname\tregion", "lat\tLatin\tItaly", "grc\tAncient Greek\tGreece"].join("\n") + "\n",
    );
  });

  afterEach(() => {
    resetGraphResolver();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds minted-csid alias entries from lexicon rows", () => {
    const entries = loadAliasEntries(tmpDir);
    const latin = entries.find((e) => e.pinakesId === "lat");
    expect(latin).toMatchObject({
      csid: "cs:language:lat",
      nodeType: "language",
      name: "Latin",
      region: "Italy",
    });
  });

  it("getGraphResolver memoises a resolver over the loaded entries", () => {
    const resolver = getGraphResolver(tmpDir);
    expect(resolver.resolve({ type: "language", id: "lat" })?.csid).toBe("cs:language:lat");
    // Same instance until reset.
    expect(getGraphResolver(tmpDir)).toBe(resolver);
    resetGraphResolver();
    expect(getGraphResolver(tmpDir)).not.toBe(resolver);
  });
});
