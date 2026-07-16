/**
 * User annotations & notes on entities (US-008, tasklist 13 platform-infra).
 *
 * An annotation is a user's own free-text note attached to a single entity
 * (language, culture, battle, …). Notes are **private by default** and can be
 * shared (made public) so other users see them on the same entity — always kept
 * clearly separate from the authoritative curated data.
 *
 * Persistence follows the `collections.ts` / `contribution-service.ts` model —
 * one JSON file per annotation under the gitignored `data/annotations/` dir — but
 * the mutation/validation/ownership logic is factored into **pure** functions
 * (no fs, no clock) so CRUD is unit-tested directly and the store is a thin
 * filesystem wrapper over them.
 *
 * Each annotation is keyed by (entity **stable id** + owner): the entity is
 * referenced by the same deterministic `cs:<node-type>:<pinakes-id>` csid
 * used by collections / the shared-graph convergence work, so an annotation
 * survives renames of denormalized display fields and lines up 1:1 with graph
 * nodes. Ownership is a soft, opaque owner id (there is no auth).
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// ============================================================================
// Types
// ============================================================================

/** A pinakes entity reference — the same shape as the client `GraphEntityRef`. */
export interface AnnotationEntityRef {
  /** Canonical node type, e.g. `"language"`, `"culture"`, `"battle"`. */
  type: string;
  /** pinakes local id — the strong, stable signal. */
  id: string;
  /** Display name, denormalized so an annotation renders without re-fetching. */
  name?: string;
  /** Optional region, denormalized for disambiguation/rendering. */
  region?: string;
}

export type AnnotationVisibility = "private" | "public";

export interface Annotation {
  id: string;
  /** `cs:<type>:<id>` — the stable entity key annotations are looked up by. */
  stableId: string;
  entity: AnnotationEntityRef;
  /** Opaque owner id (no auth — supplied by the client, persisted per browser). */
  owner: string;
  /** The note text. */
  body: string;
  visibility: AnnotationVisibility;
  createdAt: string;
  updatedAt: string;
}

/**
 * Outgoing projection of an annotation — never leaks the owner id, and tells the
 * viewer whether they may edit it (their own note). Used for every response so a
 * public note authored by another user is safe to serve.
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

/** Fields accepted when creating an annotation. */
export interface AnnotationInput {
  type?: string;
  id?: string;
  name?: string;
  region?: string;
  body?: string;
  visibility?: AnnotationVisibility;
}

/** Metadata patch for an update (body/visibility). */
export interface AnnotationPatch {
  body?: string;
  visibility?: AnnotationVisibility;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Max note length — generous, but bounds a single JSON record. */
export const MAX_ANNOTATION_LENGTH = 10_000;

// ============================================================================
// Pure helpers (no fs, no clock)
// ============================================================================

/**
 * The stable reference key for an entity — mirrors `collections.stableEntityId`
 * / `graph-resolver.mintCsid` (`cs:<node-type>:<pinakes-id>`). Kept local so
 * this module stays free of the graph-resolver's filesystem imports.
 */
export function stableEntityId(ref: Pick<AnnotationEntityRef, "type" | "id">): string {
  return `cs:${ref.type}:${ref.id}`;
}

/** Coerce an arbitrary value to a valid visibility, defaulting to `private`. */
export function normalizeVisibility(value: unknown): AnnotationVisibility {
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

/** Validate the payload for creating an annotation. */
export function validateAnnotationInput(input: Partial<AnnotationInput>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const e of validateEntityRef(input)) errors.push(e);

  if (typeof input.body !== "string" || input.body.trim() === "") {
    errors.push("body is required");
  } else if (input.body.length > MAX_ANNOTATION_LENGTH) {
    errors.push(`body must be ${MAX_ANNOTATION_LENGTH} characters or fewer`);
  }

  if (
    input.visibility !== undefined &&
    input.visibility !== "private" &&
    input.visibility !== "public"
  ) {
    errors.push("visibility must be 'private' or 'public'");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Normalize a ref down to its persisted, trimmed shape. */
function cleanRef(ref: AnnotationEntityRef): AnnotationEntityRef {
  const cleaned: AnnotationEntityRef = { type: ref.type.trim(), id: ref.id.trim() };
  if (typeof ref.name === "string" && ref.name.trim() !== "") cleaned.name = ref.name.trim();
  if (typeof ref.region === "string" && ref.region.trim() !== "") cleaned.region = ref.region.trim();
  return cleaned;
}

/**
 * Build a new annotation from validated input. Id/owner/clock are injected so the
 * function stays pure and deterministic under test.
 */
export function createAnnotation(
  input: AnnotationInput,
  ctx: { id: string; owner: string; now: string },
): Annotation {
  const entity = cleanRef({
    type: input.type ?? "",
    id: input.id ?? "",
    name: input.name,
    region: input.region,
  });
  return {
    id: ctx.id,
    stableId: stableEntityId(entity),
    entity,
    owner: ctx.owner,
    body: (input.body ?? "").trim(),
    visibility: normalizeVisibility(input.visibility),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

/** Apply a patch (body/visibility), returning a new annotation (no mutation). */
export function applyAnnotationUpdate(
  annotation: Annotation,
  patch: AnnotationPatch,
  now: string,
): Annotation {
  const next: Annotation = { ...annotation, updatedAt: now };
  if (patch.body !== undefined) next.body = patch.body.trim();
  if (patch.visibility !== undefined) next.visibility = normalizeVisibility(patch.visibility);
  return next;
}

/** True when `owner` may read the annotation (owner match or public). */
export function canView(annotation: Annotation, owner: string): boolean {
  return annotation.owner === owner || annotation.visibility === "public";
}

/** True when `owner` may mutate the annotation (owner match only). */
export function canEdit(annotation: Annotation, owner: string): boolean {
  return annotation.owner === owner;
}

/**
 * Project an annotation to its owner-free outgoing view, flagging whether the
 * given viewer may edit it. Never leaks the owner id of another user's note.
 */
export function toView(annotation: Annotation, viewer: string): AnnotationView {
  return {
    id: annotation.id,
    stableId: annotation.stableId,
    entity: annotation.entity,
    body: annotation.body,
    visibility: annotation.visibility,
    editable: canEdit(annotation, viewer),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}

/**
 * The annotations on an entity that `viewer` may see: their own (private or
 * public) plus every other user's public notes. Sorted newest-updated first,
 * but with the viewer's own notes ahead of others at the same instant.
 */
export function visibleAnnotations(all: Annotation[], stableId: string, viewer: string): Annotation[] {
  return all
    .filter((a) => a.stableId === stableId && canView(a, viewer))
    .sort((a, b) => {
      const ao = a.owner === viewer ? 0 : 1;
      const bo = b.owner === viewer ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

// ============================================================================
// Store (filesystem persistence — thin wrapper over the pure functions)
// ============================================================================

/** Thrown when an owner attempts to mutate an annotation they don't own. */
export class AnnotationAccessError extends Error {
  constructor(message = "You do not have access to this annotation") {
    super(message);
    this.name = "AnnotationAccessError";
  }
}

export class AnnotationStore {
  private dir: string;

  constructor(dataDir: string = "data/annotations") {
    this.dir = path.resolve(dataDir);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private writeFile(annotation: Annotation): void {
    fs.writeFileSync(this.filePath(annotation.id), JSON.stringify(annotation, null, 2), "utf-8");
  }

  private readAll(): Annotation[] {
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")) as Annotation);
  }

  /** Create + persist an annotation owned by `owner`. */
  create(input: AnnotationInput, owner: string): Annotation {
    const annotation = createAnnotation(input, {
      id: `note_${crypto.randomUUID()}`,
      owner,
      now: new Date().toISOString(),
    });
    this.writeFile(annotation);
    return annotation;
  }

  /** Annotations on an entity that `owner` may see (own + others' public). */
  listForEntity(stableId: string, owner: string): Annotation[] {
    return visibleAnnotations(this.readAll(), stableId, owner);
  }

  /** Raw lookup by id (no access check). */
  get(id: string): Annotation | null {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Annotation;
  }

  /** Update body/visibility; throws {@link AnnotationAccessError} if not owner. */
  update(id: string, patch: AnnotationPatch, owner: string): Annotation | null {
    const annotation = this.get(id);
    if (!annotation) return null;
    if (!canEdit(annotation, owner)) throw new AnnotationAccessError();
    const next = applyAnnotationUpdate(annotation, patch, new Date().toISOString());
    this.writeFile(next);
    return next;
  }

  /** Delete an annotation; throws if not owner. Returns false if absent. */
  remove(id: string, owner: string): boolean {
    const annotation = this.get(id);
    if (!annotation) return false;
    if (!canEdit(annotation, owner)) throw new AnnotationAccessError();
    fs.unlinkSync(this.filePath(id));
    return true;
  }
}
