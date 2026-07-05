/**
 * Collaborative collections (US-007, tasklist 13 platform-infra).
 *
 * A collection is a user-curated group of entities (languages, cultures, battles,
 * …) gathered around a theme and shareable via URL. Persistence follows the
 * `contribution-service.ts` model — one JSON file per collection under
 * `data/collections/` — but the mutation/validation/ownership logic is factored
 * into **pure** functions (no fs, no clock) so CRUD is unit-tested directly and
 * the store is a thin filesystem wrapper over them.
 *
 * Entities are referenced by a **stable id** — the same deterministic
 * `cs:<node-type>:<linguascrape-id>` csid the shared-graph convergence work mints
 * (mirrors `graph-resolver.mintCsid` / tasklist 18 US-009), so a collection item
 * survives renames of denormalized display fields and lines up 1:1 with graph nodes.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// ============================================================================
// Types
// ============================================================================

/** A LinguaScrape entity reference — the same shape as the client `GraphEntityRef`. */
export interface CollectionEntityRef {
  /** Canonical node type, e.g. `"language"`, `"culture"`, `"battle"`. */
  type: string;
  /** LinguaScrape local id — the strong, stable signal. */
  id: string;
  /** Display name, denormalized so a collection renders without re-fetching. */
  name?: string;
  /** Optional region, denormalized for disambiguation/rendering. */
  region?: string;
}

/** One curated entity inside a collection. Keyed by its stable id. */
export interface CollectionItem {
  /** `cs:<type>:<id>` — the stable dedup/reference key. */
  stableId: string;
  ref: CollectionEntityRef;
  note?: string;
  /** ISO timestamp the item was added. */
  addedAt: string;
}

export type CollectionVisibility = "private" | "public";

export interface Collection {
  id: string;
  title: string;
  description?: string;
  /** Opaque owner id (no auth — supplied by the client, persisted per browser). */
  owner: string;
  visibility: CollectionVisibility;
  /** Unguessable token for URL sharing regardless of visibility. */
  shareToken: string;
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
}

/** Public projection of a shared collection — never leaks the owner id. */
export interface CollectionShareView {
  id: string;
  title: string;
  description?: string;
  visibility: CollectionVisibility;
  items: CollectionItem[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Metadata patch for an update (title/description/visibility). */
export interface CollectionPatch {
  title?: string;
  description?: string;
  visibility?: CollectionVisibility;
}

/** Fields accepted when creating a collection. */
export interface CollectionInput {
  title?: string;
  description?: string;
  visibility?: CollectionVisibility;
  items?: CollectionEntityRef[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Pure helpers (no fs, no clock)
// ============================================================================

/**
 * The stable reference key for an entity — mirrors `graph-resolver.mintCsid`
 * (`cs:<node-type>:<linguascrape-id>`). Kept local so this module stays free of
 * the graph-resolver's filesystem imports.
 */
export function stableEntityId(ref: Pick<CollectionEntityRef, "type" | "id">): string {
  return `cs:${ref.type}:${ref.id}`;
}

/** Coerce an arbitrary value to a valid visibility, defaulting to `private`. */
export function normalizeVisibility(value: unknown): CollectionVisibility {
  return value === "public" ? "public" : "private";
}

/** Validate an entity ref: `type` and `id` are required non-empty strings. */
export function validateEntityRef(ref: unknown): string[] {
  const errors: string[] = [];
  if (!ref || typeof ref !== "object") {
    errors.push("entity ref must be an object");
    return errors;
  }
  const r = ref as Record<string, unknown>;
  if (typeof r.type !== "string" || r.type.trim() === "") {
    errors.push("entity ref requires a non-empty 'type'");
  }
  if (typeof r.id !== "string" || r.id.trim() === "") {
    errors.push("entity ref requires a non-empty 'id'");
  }
  return errors;
}

/** Validate the payload for creating a collection. */
export function validateCollectionInput(input: Partial<CollectionInput>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input.title !== "string" || input.title.trim() === "") {
    errors.push("title is required");
  } else if (input.title.length > 200) {
    errors.push("title must be 200 characters or fewer");
  }

  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push("description must be a string");
  }

  if (
    input.visibility !== undefined &&
    input.visibility !== "private" &&
    input.visibility !== "public"
  ) {
    errors.push("visibility must be 'private' or 'public'");
  }

  if (input.items !== undefined) {
    if (!Array.isArray(input.items)) {
      errors.push("items must be an array");
    } else {
      input.items.forEach((item, i) => {
        for (const e of validateEntityRef(item)) errors.push(`items[${i}]: ${e}`);
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Normalize a ref down to its persisted, trimmed shape. */
function cleanRef(ref: CollectionEntityRef): CollectionEntityRef {
  const cleaned: CollectionEntityRef = { type: ref.type.trim(), id: ref.id.trim() };
  if (typeof ref.name === "string" && ref.name.trim() !== "") cleaned.name = ref.name.trim();
  if (typeof ref.region === "string" && ref.region.trim() !== "") cleaned.region = ref.region.trim();
  return cleaned;
}

/** Build a fresh item from a ref (assumes the ref has already been validated). */
function makeItem(ref: CollectionEntityRef, note: string | undefined, now: string): CollectionItem {
  const cleaned = cleanRef(ref);
  const item: CollectionItem = {
    stableId: stableEntityId(cleaned),
    ref: cleaned,
    addedAt: now,
  };
  if (typeof note === "string" && note.trim() !== "") item.note = note.trim();
  return item;
}

/**
 * Build a new collection from validated input. Ids/token/clock are injected so
 * the function stays pure and deterministic under test.
 */
export function createCollection(
  input: CollectionInput,
  ctx: { id: string; owner: string; shareToken: string; now: string },
): Collection {
  const items: CollectionItem[] = [];
  for (const ref of input.items ?? []) {
    const item = makeItem(ref, undefined, ctx.now);
    if (!items.some((i) => i.stableId === item.stableId)) items.push(item);
  }

  const collection: Collection = {
    id: ctx.id,
    title: input.title!.trim(),
    owner: ctx.owner,
    visibility: normalizeVisibility(input.visibility),
    shareToken: ctx.shareToken,
    items,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const description = input.description?.trim();
  if (description) collection.description = description;
  return collection;
}

/** Apply a metadata patch, returning a new collection (does not mutate input). */
export function applyCollectionUpdate(
  collection: Collection,
  patch: CollectionPatch,
  now: string,
): Collection {
  const next: Collection = { ...collection, items: [...collection.items], updatedAt: now };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.description !== undefined) {
    const description = patch.description.trim();
    if (description) next.description = description;
    else delete next.description;
  }
  if (patch.visibility !== undefined) next.visibility = normalizeVisibility(patch.visibility);
  return next;
}

/**
 * Add (or update) an entity in a collection. Deduped by stable id: re-adding an
 * existing entity refreshes its ref/note but keeps the original `addedAt`.
 */
export function addCollectionItem(
  collection: Collection,
  ref: CollectionEntityRef,
  note: string | undefined,
  now: string,
): Collection {
  const item = makeItem(ref, note, now);
  const existing = collection.items.find((i) => i.stableId === item.stableId);
  const items = existing
    ? collection.items.map((i) =>
        i.stableId === item.stableId ? { ...item, addedAt: i.addedAt } : i,
      )
    : [...collection.items, item];
  return { ...collection, items, updatedAt: now };
}

/** Remove an entity by stable id. Returns a new collection (no-op if absent). */
export function removeCollectionItem(
  collection: Collection,
  stableId: string,
  now: string,
): Collection {
  const items = collection.items.filter((i) => i.stableId !== stableId);
  if (items.length === collection.items.length) return collection;
  return { ...collection, items, updatedAt: now };
}

/** True when `owner` may read the collection (owner match or public). */
export function canView(collection: Collection, owner: string): boolean {
  return collection.owner === owner || collection.visibility === "public";
}

/** True when `owner` may mutate the collection (owner match only). */
export function canEdit(collection: Collection, owner: string): boolean {
  return collection.owner === owner;
}

/** Project a collection to its owner-free public share view. */
export function toShareView(collection: Collection): CollectionShareView {
  const view: CollectionShareView = {
    id: collection.id,
    title: collection.title,
    visibility: collection.visibility,
    items: collection.items,
    itemCount: collection.items.length,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
  if (collection.description) view.description = collection.description;
  return view;
}

// ============================================================================
// Store (filesystem persistence — thin wrapper over the pure functions)
// ============================================================================

/** Thrown when an owner attempts to mutate/view a collection they don't own. */
export class CollectionAccessError extends Error {
  constructor(message = "You do not have access to this collection") {
    super(message);
    this.name = "CollectionAccessError";
  }
}

export class CollectionStore {
  private dir: string;

  constructor(dataDir: string = "data/collections") {
    this.dir = path.resolve(dataDir);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private writeFile(collection: Collection): void {
    fs.writeFileSync(this.filePath(collection.id), JSON.stringify(collection, null, 2), "utf-8");
  }

  private readAll(): Collection[] {
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")) as Collection);
  }

  /** Create + persist a collection owned by `owner`. */
  create(input: CollectionInput, owner: string): Collection {
    const collection = createCollection(input, {
      id: `col_${crypto.randomUUID()}`,
      owner,
      shareToken: crypto.randomBytes(12).toString("base64url"),
      now: new Date().toISOString(),
    });
    this.writeFile(collection);
    return collection;
  }

  /** All collections owned by `owner`, newest-updated first. */
  list(owner: string): Collection[] {
    return this.readAll()
      .filter((c) => c.owner === owner)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /** Raw lookup by id (no access check). */
  get(id: string): Collection | null {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Collection;
  }

  /** Lookup by share token (for the public share view). */
  getByShareToken(token: string): Collection | null {
    if (!token) return null;
    return this.readAll().find((c) => c.shareToken === token) ?? null;
  }

  /** Update metadata; throws {@link CollectionAccessError} if `owner` can't edit. */
  update(id: string, patch: CollectionPatch, owner: string): Collection | null {
    const collection = this.get(id);
    if (!collection) return null;
    if (!canEdit(collection, owner)) throw new CollectionAccessError();
    const next = applyCollectionUpdate(collection, patch, new Date().toISOString());
    this.writeFile(next);
    return next;
  }

  /** Delete a collection; throws if `owner` can't edit. Returns false if absent. */
  remove(id: string, owner: string): boolean {
    const collection = this.get(id);
    if (!collection) return false;
    if (!canEdit(collection, owner)) throw new CollectionAccessError();
    fs.unlinkSync(this.filePath(id));
    return true;
  }

  /** Add an entity; throws if `owner` can't edit. */
  addItem(
    id: string,
    ref: CollectionEntityRef,
    note: string | undefined,
    owner: string,
  ): Collection | null {
    const collection = this.get(id);
    if (!collection) return null;
    if (!canEdit(collection, owner)) throw new CollectionAccessError();
    const next = addCollectionItem(collection, ref, note, new Date().toISOString());
    this.writeFile(next);
    return next;
  }

  /** Remove an entity by stable id; throws if `owner` can't edit. */
  removeItem(id: string, stableId: string, owner: string): Collection | null {
    const collection = this.get(id);
    if (!collection) return null;
    if (!canEdit(collection, owner)) throw new CollectionAccessError();
    const next = removeCollectionItem(collection, stableId, new Date().toISOString());
    this.writeFile(next);
    return next;
  }
}
