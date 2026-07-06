import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  adoptDomain,
  domainsForSteward,
  isStewardOf,
  normalizeDomain,
  releaseDomain,
  resolveContributionDomain,
  stewardsForDomain,
  StewardshipStore,
  type StewardAdoption,
} from "./stewardship";
import type { Contribution } from "./contribution-service";

const NOW = "2026-07-06T00:00:00.000Z";

describe("normalizeDomain", () => {
  it("lowercases and kebab-cases", () => {
    expect(normalizeDomain("  Roman Empire ")).toBe("roman-empire");
    expect(normalizeDomain("Maya_Civilization")).toBe("maya-civilization");
    expect(normalizeDomain("Yorùbá!")).toBe("yorb");
  });
});

describe("adoptDomain (pure)", () => {
  it("adds an adoption", () => {
    const r = adoptDomain([], { steward: "Alice", domain: "Roman Empire", now: NOW });
    expect(r.alreadyOwned).toBe(false);
    expect(r.adoption).toMatchObject({ steward: "Alice", domain: "roman-empire", adoptedAt: NOW });
    expect(r.adoptions).toHaveLength(1);
  });

  it("is idempotent for an already-owned domain (case-insensitive steward)", () => {
    const first = adoptDomain([], { steward: "Alice", domain: "roman", now: NOW });
    const second = adoptDomain(first.adoptions, { steward: "alice", domain: "Roman", now: "later" });
    expect(second.alreadyOwned).toBe(true);
    expect(second.adoptions).toHaveLength(1);
    expect(second.adoption.adoptedAt).toBe(NOW);
  });

  it("does not mutate the input", () => {
    const existing: StewardAdoption[] = [];
    adoptDomain(existing, { steward: "a", domain: "b", now: NOW });
    expect(existing).toHaveLength(0);
  });
});

describe("releaseDomain / lookups", () => {
  const adoptions: StewardAdoption[] = [
    { steward: "Alice", domain: "roman", adoptedAt: NOW },
    { steward: "Bob", domain: "roman", adoptedAt: NOW },
    { steward: "Alice", domain: "maya", adoptedAt: NOW },
  ];

  it("stewardsForDomain / domainsForSteward", () => {
    expect(stewardsForDomain(adoptions, "Roman")).toEqual(["Alice", "Bob"]);
    expect(domainsForSteward(adoptions, "alice")).toEqual(["roman", "maya"]);
  });

  it("isStewardOf matches case-insensitively + normalized domain", () => {
    expect(isStewardOf(adoptions, "alice", "Roman")).toBe(true);
    expect(isStewardOf(adoptions, "Alice", "greek")).toBe(false);
  });

  it("release removes just that claim", () => {
    const { adoptions: next, released } = releaseDomain(adoptions, "Alice", "roman");
    expect(released).toBe(true);
    expect(isStewardOf(next, "Alice", "roman")).toBe(false);
    expect(isStewardOf(next, "Bob", "roman")).toBe(true);
    expect(isStewardOf(next, "Alice", "maya")).toBe(true);
  });

  it("release is a no-op for an unowned claim", () => {
    const { released } = releaseDomain(adoptions, "Nobody", "roman");
    expect(released).toBe(false);
  });
});

describe("resolveContributionDomain", () => {
  const base = {
    id: "c1",
    action: "add",
    status: "pending",
    submittedAt: NOW,
    sources: [],
    confidence: 50,
  } as unknown as Contribution;

  it("prefers an explicit culturalDomain", () => {
    const c = { ...base, entityType: "language", entityData: { culturalDomain: "Roman Empire" } } as Contribution;
    expect(resolveContributionDomain(c)).toBe("roman-empire");
  });

  it("uses the name for a civilization add", () => {
    const c = { ...base, entityType: "civilization", entityData: { name: "Maya" } } as Contribution;
    expect(resolveContributionDomain(c)).toBe("maya");
  });

  it("falls back to the entity type", () => {
    const c = { ...base, entityType: "cuisine", entityData: { name: "Sushi" } } as Contribution;
    expect(resolveContributionDomain(c)).toBe("cuisine");
  });
});

describe("StewardshipStore (fs)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stewardship-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists and reads adoptions", () => {
    const store = new StewardshipStore(dir);
    const r = store.adopt({ steward: "Alice", domain: "Roman Empire", now: NOW });
    expect(r.alreadyOwned).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(store.isSteward("alice", "roman-empire")).toBe(true);
    expect(store.listForDomain("roman-empire")).toHaveLength(1);
  });

  it("re-adopting is idempotent on disk", () => {
    const store = new StewardshipStore(dir);
    store.adopt({ steward: "Alice", domain: "roman", now: NOW });
    store.adopt({ steward: "Alice", domain: "roman", now: NOW });
    expect(store.list()).toHaveLength(1);
  });

  it("release removes the claim", () => {
    const store = new StewardshipStore(dir);
    store.adopt({ steward: "Alice", domain: "roman", now: NOW });
    expect(store.release("Alice", "roman")).toBe(true);
    expect(store.list()).toHaveLength(0);
  });
});
