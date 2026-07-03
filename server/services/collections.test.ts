import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  CollectionAccessError,
  CollectionStore,
  addCollectionItem,
  applyCollectionUpdate,
  canEdit,
  canView,
  createCollection,
  normalizeVisibility,
  removeCollectionItem,
  stableEntityId,
  toShareView,
  validateCollectionInput,
  validateEntityRef,
  type Collection,
} from "./collections";

const NOW = "2026-07-03T00:00:00.000Z";
const LATER = "2026-07-03T01:00:00.000Z";

function baseCollection(overrides: Partial<Collection> = {}): Collection {
  const c = createCollection(
    { title: "Bronze Age", description: "Bronze-age cultures" },
    { id: "col_1", owner: "alice", shareToken: "tok_abc", now: NOW },
  );
  return { ...c, ...overrides };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("stableEntityId", () => {
  it("mints the deterministic cs:<type>:<id> csid", () => {
    expect(stableEntityId({ type: "language", id: "eng" })).toBe("cs:language:eng");
    expect(stableEntityId({ type: "culture", id: "sumer" })).toBe("cs:culture:sumer");
  });
});

describe("normalizeVisibility", () => {
  it("defaults anything but 'public' to 'private'", () => {
    expect(normalizeVisibility("public")).toBe("public");
    expect(normalizeVisibility("private")).toBe("private");
    expect(normalizeVisibility(undefined)).toBe("private");
    expect(normalizeVisibility("garbage")).toBe("private");
  });
});

describe("validateCollectionInput", () => {
  it("requires a non-empty title", () => {
    expect(validateCollectionInput({}).valid).toBe(false);
    expect(validateCollectionInput({ title: "   " }).valid).toBe(false);
    expect(validateCollectionInput({ title: "Ok" }).valid).toBe(true);
  });

  it("rejects bad visibility and non-array items", () => {
    expect(validateCollectionInput({ title: "x", visibility: "secret" as never }).valid).toBe(false);
    expect(validateCollectionInput({ title: "x", items: "nope" as never }).valid).toBe(false);
  });

  it("validates each item ref", () => {
    const res = validateCollectionInput({ title: "x", items: [{ type: "", id: "" } as never] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith("items[0]"))).toBe(true);
  });
});

describe("validateEntityRef", () => {
  it("requires non-empty type and id", () => {
    expect(validateEntityRef({ type: "language", id: "eng" })).toEqual([]);
    expect(validateEntityRef({ type: "", id: "eng" }).length).toBe(1);
    expect(validateEntityRef({ type: "language" }).length).toBe(1);
    expect(validateEntityRef(null).length).toBe(1);
  });
});

describe("createCollection", () => {
  it("builds a collection, dedups seed items, and trims fields", () => {
    const c = createCollection(
      {
        title: "  Bronze Age  ",
        description: "  cultures  ",
        visibility: "public",
        items: [
          { type: "culture", id: "sumer", name: " Sumer " },
          { type: "culture", id: "sumer" }, // duplicate stable id
          { type: "language", id: "akk" },
        ],
      },
      { id: "col_1", owner: "alice", shareToken: "tok", now: NOW },
    );
    expect(c.title).toBe("Bronze Age");
    expect(c.description).toBe("cultures");
    expect(c.visibility).toBe("public");
    expect(c.items).toHaveLength(2);
    expect(c.items[0]).toMatchObject({ stableId: "cs:culture:sumer", addedAt: NOW });
    expect(c.items[0].ref.name).toBe("Sumer");
    expect(c.createdAt).toBe(NOW);
    expect(c.updatedAt).toBe(NOW);
  });

  it("omits an empty description", () => {
    const c = createCollection(
      { title: "x", description: "   " },
      { id: "1", owner: "a", shareToken: "t", now: NOW },
    );
    expect(c.description).toBeUndefined();
  });
});

describe("applyCollectionUpdate", () => {
  const c = baseCollection();

  it("patches title/description/visibility and bumps updatedAt without mutating input", () => {
    const next = applyCollectionUpdate(c, { title: " Iron Age ", visibility: "public" }, LATER);
    expect(next.title).toBe("Iron Age");
    expect(next.visibility).toBe("public");
    expect(next.updatedAt).toBe(LATER);
    expect(c.title).toBe("Bronze Age"); // unchanged
  });

  it("clears the description when patched empty", () => {
    const next = applyCollectionUpdate(c, { description: "  " }, LATER);
    expect(next.description).toBeUndefined();
  });
});

describe("addCollectionItem", () => {
  const c = baseCollection();

  it("appends a new item", () => {
    const next = addCollectionItem(c, { type: "battle", id: "kadesh", name: "Kadesh" }, "note", LATER);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ stableId: "cs:battle:kadesh", note: "note", addedAt: LATER });
    expect(next.updatedAt).toBe(LATER);
  });

  it("dedups by stable id, refreshing ref/note but keeping addedAt", () => {
    const once = addCollectionItem(c, { type: "battle", id: "kadesh", name: "Kadesh" }, undefined, NOW);
    const twice = addCollectionItem(once, { type: "battle", id: "kadesh", name: "Battle of Kadesh" }, "reread", LATER);
    expect(twice.items).toHaveLength(1);
    expect(twice.items[0].ref.name).toBe("Battle of Kadesh");
    expect(twice.items[0].note).toBe("reread");
    expect(twice.items[0].addedAt).toBe(NOW); // original timestamp preserved
  });
});

describe("removeCollectionItem", () => {
  it("removes by stable id and is a no-op when absent", () => {
    const withItem = addCollectionItem(baseCollection(), { type: "battle", id: "kadesh" }, undefined, NOW);
    const removed = removeCollectionItem(withItem, "cs:battle:kadesh", LATER);
    expect(removed.items).toHaveLength(0);
    expect(removed.updatedAt).toBe(LATER);

    const noop = removeCollectionItem(withItem, "cs:battle:absent", LATER);
    expect(noop).toBe(withItem); // same reference, no update
  });
});

describe("ownership + share view", () => {
  const priv = baseCollection({ owner: "alice", visibility: "private" });
  const pub = baseCollection({ owner: "alice", visibility: "public" });

  it("canView allows owner always and non-owner only when public", () => {
    expect(canView(priv, "alice")).toBe(true);
    expect(canView(priv, "bob")).toBe(false);
    expect(canView(pub, "bob")).toBe(true);
  });

  it("canEdit is owner-only", () => {
    expect(canEdit(priv, "alice")).toBe(true);
    expect(canEdit(priv, "bob")).toBe(false);
    expect(canEdit(pub, "bob")).toBe(false);
  });

  it("toShareView omits the owner id", () => {
    const view = toShareView(addCollectionItem(pub, { type: "culture", id: "sumer" }, undefined, NOW));
    expect(view).not.toHaveProperty("owner");
    expect(view).not.toHaveProperty("shareToken");
    expect(view.itemCount).toBe(1);
    expect(view.id).toBe(pub.id);
  });
});

// ---------------------------------------------------------------------------
// Store CRUD (against a temp dir)
// ---------------------------------------------------------------------------

describe("CollectionStore CRUD", () => {
  let dir: string;
  let store: CollectionStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "collections-test-"));
    store = new CollectionStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates, persists, gets, and lists a collection for its owner", () => {
    const created = store.create({ title: "My set", items: [{ type: "language", id: "eng" }] }, "alice");
    expect(created.id).toMatch(/^col_/);
    expect(created.shareToken).toBeTruthy();
    expect(created.items).toHaveLength(1);

    // Persisted to disk as JSON
    expect(fs.existsSync(path.join(dir, `${created.id}.json`))).toBe(true);

    // A fresh store instance over the same dir reads it back
    const reloaded = new CollectionStore(dir).get(created.id);
    expect(reloaded?.title).toBe("My set");

    // list is owner-scoped
    expect(store.list("alice").map((c) => c.id)).toEqual([created.id]);
    expect(store.list("bob")).toEqual([]);
  });

  it("lists all of an owner's collections and none of another's", () => {
    store.create({ title: "A" }, "alice");
    store.create({ title: "B" }, "alice");
    store.create({ title: "C" }, "bob");
    expect(store.list("alice").map((c) => c.title).sort()).toEqual(["A", "B"]);
    expect(store.list("bob").map((c) => c.title)).toEqual(["C"]);
  });

  it("updates metadata and enforces owner-only edits", () => {
    const c = store.create({ title: "orig" }, "alice");
    const updated = store.update(c.id, { title: "renamed", visibility: "public" }, "alice");
    expect(updated?.title).toBe("renamed");
    expect(updated?.visibility).toBe("public");
    expect(() => store.update(c.id, { title: "x" }, "bob")).toThrow(CollectionAccessError);
    expect(store.update("col_missing", { title: "x" }, "alice")).toBeNull();
  });

  it("adds and removes items by stable id", () => {
    const c = store.create({ title: "set" }, "alice");
    const withItem = store.addItem(c.id, { type: "battle", id: "kadesh", name: "Kadesh" }, "note", "alice");
    expect(withItem?.items[0].stableId).toBe("cs:battle:kadesh");

    const removed = store.removeItem(c.id, "cs:battle:kadesh", "alice");
    expect(removed?.items).toHaveLength(0);

    expect(() => store.addItem(c.id, { type: "battle", id: "x" }, undefined, "bob")).toThrow(
      CollectionAccessError,
    );
  });

  it("deletes a collection (owner-only) and resolves the share token", () => {
    const c = store.create({ title: "temp", visibility: "public" }, "alice");
    expect(store.getByShareToken(c.shareToken)?.id).toBe(c.id);
    expect(store.getByShareToken("nope")).toBeNull();

    expect(() => store.remove(c.id, "bob")).toThrow(CollectionAccessError);
    expect(store.remove(c.id, "alice")).toBe(true);
    expect(store.get(c.id)).toBeNull();
    expect(store.remove("col_missing", "alice")).toBe(false);
  });
});
