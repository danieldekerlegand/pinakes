import { describe, it, expect } from "vitest";

import {
  collectionQueryKey,
  collectionShareUrl,
  collectionsQueryKey,
  isEntityInCollection,
  sharedCollectionQueryKey,
  stableEntityId,
  toCollectionRef,
  type Collection,
} from "./collections";

describe("stableEntityId", () => {
  it("mints cs:<type>:<id>", () => {
    expect(stableEntityId({ type: "language", id: "eng" })).toBe("cs:language:eng");
  });
});

describe("toCollectionRef", () => {
  it("returns null when id or type is missing/blank", () => {
    expect(toCollectionRef({ type: "language" })).toBeNull();
    expect(toCollectionRef({ type: "language", id: "  " })).toBeNull();
    expect(toCollectionRef({ type: "", id: "eng" })).toBeNull();
  });

  it("keeps optional name/region when present", () => {
    expect(toCollectionRef({ type: "language", id: "eng", name: "English", region: "Britain" })).toEqual({
      type: "language",
      id: "eng",
      name: "English",
      region: "Britain",
    });
    expect(toCollectionRef({ type: "language", id: "eng" })).toEqual({ type: "language", id: "eng" });
  });
});

describe("isEntityInCollection", () => {
  const collection = {
    items: [
      { stableId: "cs:language:eng", ref: { type: "language", id: "eng" }, addedAt: "" },
      { stableId: "cs:culture:sumer", ref: { type: "culture", id: "sumer" }, addedAt: "" },
    ],
  } satisfies Pick<Collection, "items">;

  it("detects membership by stable id", () => {
    expect(isEntityInCollection(collection, { type: "language", id: "eng" })).toBe(true);
    expect(isEntityInCollection(collection, { type: "language", id: "fra" })).toBe(false);
    // same id, different type is a different entity
    expect(isEntityInCollection(collection, { type: "culture", id: "eng" })).toBe(false);
  });
});

describe("collectionShareUrl", () => {
  it("builds a /shared/collection/:token url", () => {
    expect(collectionShareUrl("tok123")).toBe("/shared/collection/tok123");
    expect(collectionShareUrl("tok123", "https://x.dev")).toBe("https://x.dev/shared/collection/tok123");
  });
});

describe("query-key builders", () => {
  it("carry owner as an object part (→ query param) for owned reads", () => {
    expect(collectionsQueryKey("alice")).toEqual(["/api/collections", { owner: "alice" }]);
    expect(collectionQueryKey("col_1", "alice")).toEqual(["/api/collections/col_1", { owner: "alice" }]);
  });

  it("omit owner for the public share view", () => {
    expect(sharedCollectionQueryKey("tok")).toEqual(["/api/collections/shared/tok"]);
  });
});
