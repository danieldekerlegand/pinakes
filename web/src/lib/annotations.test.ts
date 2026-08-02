import { describe, it, expect } from "vitest";

import {
  entityAnnotationsQueryKey,
  stableEntityId,
  toAnnotationRef,
} from "./annotations";

describe("stableEntityId", () => {
  it("mints the deterministic cs:<type>:<id> key", () => {
    expect(stableEntityId({ type: "language", id: "eng" })).toBe("cs:language:eng");
  });
});

describe("toAnnotationRef", () => {
  it("keeps a full ref and drops empty optionals", () => {
    expect(toAnnotationRef({ type: "culture", id: "sumer", name: "Sumer", region: "Mesopotamia" })).toEqual({
      type: "culture",
      id: "sumer",
      name: "Sumer",
      region: "Mesopotamia",
    });
    expect(toAnnotationRef({ type: "battle", id: "kadesh" })).toEqual({ type: "battle", id: "kadesh" });
  });

  it("returns null when type or id is missing", () => {
    expect(toAnnotationRef({ type: "language", id: "" })).toBeNull();
    expect(toAnnotationRef({ type: "", id: "eng" })).toBeNull();
    expect(toAnnotationRef({ type: "language", id: "   " })).toBeNull();
  });
});

describe("entityAnnotationsQueryKey", () => {
  it("scopes the list to a stable id + owner", () => {
    expect(entityAnnotationsQueryKey("cs:language:eng", "owner_1")).toEqual([
      "/api/annotations",
      { entity: "cs:language:eng", owner: "owner_1" },
    ]);
  });
});
