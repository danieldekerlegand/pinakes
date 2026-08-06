/**
 * User annotations & notes — client-side types + pure helpers (US-008).
 *
 * Mirrors the server contract in `services/api/src/pinakes/collab/annotations.py`. The pure,
 * side-effect-free helpers here (stable-id, query-key builders, ref coercion)
 * are unit-tested in the node-env vitest suite; the React Query hooks live in
 * `web/src/hooks/use-annotations.ts` and the UI in
 * `web/src/components/annotations/EntityAnnotations.tsx`.
 *
 * Owner identity is the same per-browser opaque id used by collections — reused
 * from `lib/collections.getOwnerId` so a browser has one identity everywhere.
 */

import type { GraphEntityRef } from "@/components/graph/ShowInGraphButton";

export type AnnotationVisibility = "private" | "public";

/** An entity reference — the same shape as {@link GraphEntityRef}. */
export interface AnnotationEntityRef {
  type: string;
  id: string;
  name?: string;
  region?: string;
}

/**
 * The outgoing (owner-free) annotation view served by the API. `editable` tells
 * the client whether the current browser-owner may edit/delete this note.
 */
export interface AnnotationView {
  id: string;
  stableId: string;
  entity: AnnotationEntityRef;
  body: string;
  visibility: AnnotationVisibility;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The stable reference key for an entity — mirrors the server's
 * `stableEntityId` / `graph-resolver.mintCsid` (`cs:<type>:<id>`).
 */
export function stableEntityId(ref: Pick<AnnotationEntityRef, "type" | "id">): string {
  return `cs:${ref.type}:${ref.id}`;
}

/** Coerce a GraphEntityRef (id optional) into a full AnnotationEntityRef, or null. */
export function toAnnotationRef(ref: GraphEntityRef): AnnotationEntityRef | null {
  if (!ref.id || ref.id.trim() === "" || !ref.type || ref.type.trim() === "") return null;
  const out: AnnotationEntityRef = { type: ref.type, id: ref.id };
  if (ref.name) out.name = ref.name;
  if (ref.region) out.region = ref.region;
  return out;
}

// --- React Query key builders -------------------------------------------------

/**
 * The annotations on one entity, scoped to a viewer. `entity` (the stable id) and
 * `owner` become `?entity=&owner=` query params via the default `getQueryFn`, so
 * the server returns the viewer's own notes plus everyone's public ones.
 */
export function entityAnnotationsQueryKey(
  stableId: string,
  owner: string,
): [string, { entity: string; owner: string }] {
  return ["/api/annotations", { entity: stableId, owner }];
}
