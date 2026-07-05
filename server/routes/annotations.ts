/**
 * First-party `/api/annotations/*` routes (US-008, tasklist 13 platform-infra).
 *
 * User notes on entities: list the annotations visible to the caller for one
 * entity, create/edit/delete your own, and share a note (make it public) so it
 * surfaces on the same entity for everyone. Notes are private by default and are
 * always kept separate from the authoritative curated data.
 *
 * As elsewhere in this project there is no auth (see `contribution-service.ts` /
 * `collections.ts`): ownership is a soft, opaque owner id read — in priority
 * order — from the `x-owner-id` header, the `owner` query param, or the `owner`
 * body field, defaulting to `"anonymous"`.
 *
 * The validation/mutation/ownership logic is pure (server/services/annotations.ts);
 * this module only wires HTTP, resolves the owner, and maps errors to status codes.
 * Every outgoing annotation is projected through `toView` so another user's owner
 * id never leaks and the client learns which notes it may edit.
 */
import { type Express, type Request, type Response } from "express";

import {
  AnnotationAccessError,
  AnnotationStore,
  canView,
  stableEntityId,
  toView,
  validateAnnotationInput,
  type AnnotationPatch,
  type AnnotationVisibility,
} from "../services/annotations";

/** Lazy module singleton so the store (and its data dir) is created once. */
let defaultStore: AnnotationStore | null = null;
function getStore(): AnnotationStore {
  if (!defaultStore) defaultStore = new AnnotationStore();
  return defaultStore;
}

/** Resolve the soft owner id from header → query → body, defaulting to anonymous. */
function resolveOwner(req: Request): string {
  const header = req.header("x-owner-id");
  if (typeof header === "string" && header.trim() !== "") return header.trim();
  const query = req.query.owner;
  if (typeof query === "string" && query.trim() !== "") return query.trim();
  const body = (req.body as Record<string, unknown> | undefined)?.owner;
  if (typeof body === "string" && body.trim() !== "") return body.trim();
  return "anonymous";
}

function normalizePatch(body: Record<string, unknown>): AnnotationPatch {
  const patch: AnnotationPatch = {};
  if (typeof body.body === "string") patch.body = body.body;
  if (body.visibility === "private" || body.visibility === "public") {
    patch.visibility = body.visibility as AnnotationVisibility;
  }
  return patch;
}

export function registerAnnotationRoutes(app: Express, store: AnnotationStore = getStore()): void {
  /**
   * GET /api/annotations?entity=cs:type:id  (or ?type=&id=)
   * List the annotations on an entity visible to the caller (own + others' public).
   */
  app.get("/api/annotations", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const stableId = resolveStableId(req);
      if (!stableId) {
        res.status(400).json({ error: "invalid entity", errors: ["entity (or type+id) is required"] });
        return;
      }
      const annotations = store.listForEntity(stableId, owner).map((a) => toView(a, owner));
      res.json({ annotations, total: annotations.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error listing annotations:", error);
      res.status(500).json({ error: "listing annotations failed", detail: message });
    }
  });

  /** POST /api/annotations — create a note on an entity. */
  app.post("/api/annotations", (req: Request, res: Response) => {
    const validation = validateAnnotationInput(req.body ?? {});
    if (!validation.valid) {
      res.status(400).json({ error: "invalid annotation", errors: validation.errors });
      return;
    }
    try {
      const owner = resolveOwner(req);
      const annotation = store.create(req.body, owner);
      res.status(201).json({ annotation: toView(annotation, owner) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error creating annotation:", error);
      res.status(500).json({ error: "creating annotation failed", detail: message });
    }
  });

  /** GET /api/annotations/:id — read one (owner or public). */
  app.get("/api/annotations/:id", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const annotation = store.get(req.params.id);
      if (!annotation) {
        res.status(404).json({ error: "Not found", detail: `No annotation ${req.params.id}` });
        return;
      }
      if (!canView(annotation, owner)) {
        res.status(403).json({ error: "Forbidden", detail: "This annotation is private" });
        return;
      }
      res.json({ annotation: toView(annotation, owner) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error loading annotation:", error);
      res.status(500).json({ error: "loading annotation failed", detail: message });
    }
  });

  /** PATCH /api/annotations/:id — edit body/visibility (owner only). */
  app.patch("/api/annotations/:id", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const patch = normalizePatch(req.body ?? {});
      if (patch.body !== undefined && patch.body.trim() === "") {
        res.status(400).json({ error: "invalid annotation", errors: ["body cannot be empty"] });
        return;
      }
      const annotation = store.update(req.params.id, patch, owner);
      if (!annotation) {
        res.status(404).json({ error: "Not found", detail: `No annotation ${req.params.id}` });
        return;
      }
      res.json({ annotation: toView(annotation, owner) });
    } catch (error) {
      if (error instanceof AnnotationAccessError) {
        res.status(403).json({ error: "Forbidden", detail: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error updating annotation:", error);
      res.status(500).json({ error: "updating annotation failed", detail: message });
    }
  });

  /** DELETE /api/annotations/:id — delete a note (owner only). */
  app.delete("/api/annotations/:id", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const removed = store.remove(req.params.id, owner);
      if (!removed) {
        res.status(404).json({ error: "Not found", detail: `No annotation ${req.params.id}` });
        return;
      }
      res.json({ ok: true, id: req.params.id });
    } catch (error) {
      if (error instanceof AnnotationAccessError) {
        res.status(403).json({ error: "Forbidden", detail: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error deleting annotation:", error);
      res.status(500).json({ error: "deleting annotation failed", detail: message });
    }
  });
}

/** Resolve the entity stable id from `?entity=` or `?type=&id=` query params. */
function resolveStableId(req: Request): string | null {
  const entity = req.query.entity;
  if (typeof entity === "string" && entity.trim() !== "") return entity.trim();
  const type = req.query.type;
  const id = req.query.id;
  if (typeof type === "string" && type.trim() !== "" && typeof id === "string" && id.trim() !== "") {
    return stableEntityId({ type: type.trim(), id: id.trim() });
  }
  return null;
}
