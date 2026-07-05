import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  AnnotationAccessError,
  AnnotationStore,
  applyAnnotationUpdate,
  canEdit,
  canView,
  createAnnotation,
  normalizeVisibility,
  stableEntityId,
  toView,
  validateAnnotationInput,
  validateEntityRef,
  visibleAnnotations,
  type Annotation,
} from "./annotations";

const NOW = "2026-07-03T00:00:00.000Z";
const LATER = "2026-07-03T01:00:00.000Z";

function baseAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  const a = createAnnotation(
    { type: "language", id: "eng", name: "English", body: "  a private note  " },
    { id: "note_1", owner: "alice", now: NOW },
  );
  return { ...a, ...overrides };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("stableEntityId", () => {
  it("mints the deterministic cs:<type>:<id> csid", () => {
    expect(stableEntityId({ type: "language", id: "eng" })).toBe("cs:language:eng");
  });
});

describe("normalizeVisibility", () => {
  it("only 'public' is public; everything else is private", () => {
    expect(normalizeVisibility("public")).toBe("public");
    expect(normalizeVisibility("private")).toBe("private");
    expect(normalizeVisibility(undefined)).toBe("private");
    expect(normalizeVisibility("nonsense")).toBe("private");
  });
});

describe("validateEntityRef", () => {
  it("requires non-empty type and id", () => {
    expect(validateEntityRef({ type: "language", id: "eng" })).toEqual([]);
    expect(validateEntityRef({ type: "", id: "eng" })).toContain(
      "entity ref requires a non-empty 'type'",
    );
    expect(validateEntityRef({ type: "language", id: "  " })).toContain(
      "entity ref requires a non-empty 'id'",
    );
    expect(validateEntityRef(null)).toContain("entity ref must be an object");
  });
});

describe("validateAnnotationInput", () => {
  it("accepts a valid note", () => {
    const r = validateAnnotationInput({ type: "battle", id: "kadesh", body: "note" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("requires entity ref and a non-empty body", () => {
    const r = validateAnnotationInput({ type: "", id: "", body: "  " });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("entity ref requires a non-empty 'type'");
    expect(r.errors).toContain("entity ref requires a non-empty 'id'");
    expect(r.errors).toContain("body is required");
  });

  it("rejects an over-long body and a bad visibility", () => {
    const r = validateAnnotationInput({
      type: "language",
      id: "eng",
      body: "x".repeat(10_001),
      visibility: "loud" as never,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("characters or fewer"))).toBe(true);
    expect(r.errors).toContain("visibility must be 'private' or 'public'");
  });
});

describe("createAnnotation", () => {
  it("trims the body, cleans the ref, and defaults to private", () => {
    const a = baseAnnotation();
    expect(a.id).toBe("note_1");
    expect(a.owner).toBe("alice");
    expect(a.stableId).toBe("cs:language:eng");
    expect(a.entity).toEqual({ type: "language", id: "eng", name: "English" });
    expect(a.body).toBe("a private note");
    expect(a.visibility).toBe("private");
    expect(a.createdAt).toBe(NOW);
    expect(a.updatedAt).toBe(NOW);
  });

  it("honours an explicit public visibility", () => {
    const a = createAnnotation(
      { type: "culture", id: "sumer", body: "shared", visibility: "public" },
      { id: "note_2", owner: "bob", now: NOW },
    );
    expect(a.visibility).toBe("public");
  });
});

describe("applyAnnotationUpdate", () => {
  it("updates body/visibility, bumps updatedAt, and does not mutate the input", () => {
    const a = baseAnnotation();
    const next = applyAnnotationUpdate(a, { body: "  edited  ", visibility: "public" }, LATER);
    expect(next.body).toBe("edited");
    expect(next.visibility).toBe("public");
    expect(next.updatedAt).toBe(LATER);
    expect(next.createdAt).toBe(NOW);
    // original untouched
    expect(a.body).toBe("a private note");
    expect(a.visibility).toBe("private");
  });
});

describe("canView / canEdit", () => {
  it("owner may view+edit; a non-owner may only view when public", () => {
    const priv = baseAnnotation();
    expect(canView(priv, "alice")).toBe(true);
    expect(canEdit(priv, "alice")).toBe(true);
    expect(canView(priv, "bob")).toBe(false);
    expect(canEdit(priv, "bob")).toBe(false);

    const pub = baseAnnotation({ visibility: "public" });
    expect(canView(pub, "bob")).toBe(true);
    expect(canEdit(pub, "bob")).toBe(false);
  });
});

describe("toView", () => {
  it("strips the owner and flags editability for the viewer", () => {
    const a = baseAnnotation();
    const own = toView(a, "alice");
    expect(own).not.toHaveProperty("owner");
    expect(own.editable).toBe(true);
    expect(own.body).toBe("a private note");
    expect(toView(a, "bob").editable).toBe(false);
  });
});

describe("visibleAnnotations", () => {
  it("returns own notes + others' public, own-first then newest-updated", () => {
    const all: Annotation[] = [
      baseAnnotation({ id: "own-old", owner: "alice", updatedAt: NOW }),
      baseAnnotation({ id: "own-new", owner: "alice", updatedAt: LATER }),
      baseAnnotation({ id: "bob-public", owner: "bob", visibility: "public", updatedAt: LATER }),
      baseAnnotation({ id: "bob-private", owner: "bob", visibility: "private", updatedAt: LATER }),
      baseAnnotation({ id: "other-entity", owner: "alice", stableId: "cs:culture:x" }),
    ];
    const out = visibleAnnotations(all, "cs:language:eng", "alice").map((a) => a.id);
    expect(out).toEqual(["own-new", "own-old", "bob-public"]);
    expect(out).not.toContain("bob-private");
    expect(out).not.toContain("other-entity");
  });
});

// ---------------------------------------------------------------------------
// Store (real temp-dir filesystem)
// ---------------------------------------------------------------------------

describe("AnnotationStore", () => {
  let dir: string;
  let store: AnnotationStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "annotations-store-"));
    store = new AnnotationStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates, lists-for-entity, updates, and deletes", () => {
    const a = store.create({ type: "language", id: "eng", body: "first" }, "alice");
    expect(a.owner).toBe("alice");
    expect(fs.existsSync(path.join(dir, `${a.id}.json`))).toBe(true);

    const listed = store.listForEntity("cs:language:eng", "alice");
    expect(listed).toHaveLength(1);
    expect(listed[0].body).toBe("first");

    const updated = store.update(a.id, { body: "edited", visibility: "public" }, "alice");
    expect(updated?.body).toBe("edited");
    expect(updated?.visibility).toBe("public");

    expect(store.remove(a.id, "alice")).toBe(true);
    expect(store.get(a.id)).toBeNull();
    expect(store.listForEntity("cs:language:eng", "alice")).toHaveLength(0);
  });

  it("scopes list visibility: a non-owner sees only public notes", () => {
    store.create({ type: "culture", id: "sumer", body: "alice private" }, "alice");
    store.create({ type: "culture", id: "sumer", body: "alice public", visibility: "public" }, "alice");

    expect(store.listForEntity("cs:culture:sumer", "alice")).toHaveLength(2);
    const bobSees = store.listForEntity("cs:culture:sumer", "bob");
    expect(bobSees).toHaveLength(1);
    expect(bobSees[0].body).toBe("alice public");
  });

  it("throws AnnotationAccessError when a non-owner mutates", () => {
    const a = store.create({ type: "battle", id: "kadesh", body: "n" }, "alice");
    expect(() => store.update(a.id, { body: "hijack" }, "bob")).toThrow(AnnotationAccessError);
    expect(() => store.remove(a.id, "bob")).toThrow(AnnotationAccessError);
  });

  it("returns null/false for a missing id", () => {
    expect(store.get("note_missing")).toBeNull();
    expect(store.update("note_missing", { body: "x" }, "alice")).toBeNull();
    expect(store.remove("note_missing", "alice")).toBe(false);
  });
});
