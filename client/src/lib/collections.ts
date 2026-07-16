/**
 * Collaborative collections — client-side types + pure helpers (US-007).
 *
 * Mirrors the server contract in `server/services/collections.ts`. The pure,
 * side-effect-free helpers here (stable-id, share-url, query-key builders,
 * membership checks) are unit-tested in the node-env vitest suite; the React
 * Query hooks live in `client/src/hooks/use-collections.ts` and the UI in
 * `client/src/pages/collections.tsx` + `components/collections/`.
 */

import type { GraphEntityRef } from "@/components/graph/ShowInGraphButton";

export type CollectionVisibility = "private" | "public";

/** An entity reference — the same shape as {@link GraphEntityRef}. */
export interface CollectionEntityRef {
  type: string;
  id: string;
  name?: string;
  region?: string;
}

export interface CollectionItem {
  stableId: string;
  ref: CollectionEntityRef;
  note?: string;
  addedAt: string;
}

export interface Collection {
  id: string;
  title: string;
  description?: string;
  owner: string;
  visibility: CollectionVisibility;
  shareToken: string;
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
}

/** Owner-free public share projection returned by `/api/collections/shared/:token`. */
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

/**
 * The stable reference key for an entity — mirrors the server's
 * `stableEntityId` / `graph-resolver.mintCsid` (`cs:<type>:<id>`).
 */
export function stableEntityId(ref: Pick<CollectionEntityRef, "type" | "id">): string {
  return `cs:${ref.type}:${ref.id}`;
}

/** Coerce a GraphEntityRef (id optional) into a full CollectionEntityRef, or null. */
export function toCollectionRef(ref: GraphEntityRef): CollectionEntityRef | null {
  if (!ref.id || ref.id.trim() === "" || !ref.type || ref.type.trim() === "") return null;
  const out: CollectionEntityRef = { type: ref.type, id: ref.id };
  if (ref.name) out.name = ref.name;
  if (ref.region) out.region = ref.region;
  return out;
}

/** True when the collection already contains the given entity. */
export function isEntityInCollection(
  collection: Pick<Collection, "items">,
  ref: Pick<CollectionEntityRef, "type" | "id">,
): boolean {
  const key = stableEntityId(ref);
  return collection.items.some((i) => i.stableId === key);
}

/** Absolute, shareable URL for a collection's share token. */
export function collectionShareUrl(token: string, origin = ""): string {
  return `${origin}/shared/collection/${token}`;
}

// --- React Query key builders -------------------------------------------------

/** List of the owner's collections. `owner` becomes an `?owner=` query param. */
export function collectionsQueryKey(owner: string): [string, { owner: string }] {
  return ["/api/collections", { owner }];
}

/** One owned collection (owner passed so the server can authorize the read). */
export function collectionQueryKey(id: string, owner: string): [string, { owner: string }] {
  return [`/api/collections/${id}`, { owner }];
}

/** A public share view keyed by token (no owner needed). */
export function sharedCollectionQueryKey(token: string): [string] {
  return [`/api/collections/shared/${token}`];
}

// --- Owner identity -----------------------------------------------------------

const OWNER_STORAGE_KEY = "pinakes.collections.ownerId";

/**
 * A stable, per-browser owner id (no auth). Persisted in localStorage; generated
 * on first use. Falls back to `"anonymous"` when storage/crypto are unavailable
 * (SSR, privacy mode) so callers always get a usable string.
 */
export function getOwnerId(): string {
  try {
    if (typeof localStorage === "undefined") return "anonymous";
    const existing = localStorage.getItem(OWNER_STORAGE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `owner_${crypto.randomUUID()}`
        : `owner_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(OWNER_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "anonymous";
  }
}
