/**
 * First-party `/api/collections/*` routes (US-007, tasklist 13 platform-infra).
 *
 * Collaborative collections: create/list/get/update/delete a themed group of
 * entities, add/remove entities (referenced by their stable `cs:<type>:<id>` id),
 * and share a collection read-only via an unguessable token URL.
 *
 * There is no auth in this project (see `contribution-service.ts`), so ownership
 * is a soft, opaque owner id supplied by the client and persisted per browser.
 * It is read — in priority order — from the `x-owner-id` header, the `owner`
 * query param, or the `owner` body field, defaulting to `"anonymous"`.
 *
 * The validation/mutation/ownership logic is pure (server/services/collections.ts);
 * this module only wires HTTP, resolves the owner, and maps errors to status codes.
 */
import { type Express, type Request, type Response } from "express";

import {
  CollectionAccessError,
  CollectionStore,
  toShareView,
  validateCollectionInput,
  validateEntityRef,
  type CollectionPatch,
  type CollectionVisibility,
} from "../services/collections";

/** Lazy module singleton so the store (and its data dir) is created once. */
let defaultStore: CollectionStore | null = null;
function getStore(): CollectionStore {
  if (!defaultStore) defaultStore = new CollectionStore();
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

function normalizePatch(body: Record<string, unknown>): CollectionPatch {
  const patch: CollectionPatch = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string") patch.description = body.description;
  if (body.visibility === "private" || body.visibility === "public") {
    patch.visibility = body.visibility as CollectionVisibility;
  }
  return patch;
}

export function registerCollectionRoutes(app: Express, store: CollectionStore = getStore()): void {
  /** GET /api/collections — list the owner's collections (newest-updated first). */
  app.get("/api/collections", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const collections = store.list(owner);
      res.json({ collections, total: collections.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error listing collections:", error);
      res.status(500).json({ error: "listing collections failed", detail: message });
    }
  });

  /** POST /api/collections — create a collection. */
  app.post("/api/collections", (req: Request, res: Response) => {
    const validation = validateCollectionInput(req.body ?? {});
    if (!validation.valid) {
      res.status(400).json({ error: "invalid collection", errors: validation.errors });
      return;
    }
    try {
      const owner = resolveOwner(req);
      const collection = store.create(req.body, owner);
      res.status(201).json({ collection });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error creating collection:", error);
      res.status(500).json({ error: "creating collection failed", detail: message });
    }
  });

  /**
   * GET /api/collections/shared/:token — read-only public share view (no owner
   * check; the unguessable token is the capability). Registered before `/:id`.
   */
  app.get("/api/collections/shared/:token", (req: Request, res: Response) => {
    try {
      const collection = store.getByShareToken(req.params.token);
      if (!collection) {
        res.status(404).json({ error: "Not found", detail: "No shared collection for that token" });
        return;
      }
      res.json({ collection: toShareView(collection) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error loading shared collection:", error);
      res.status(500).json({ error: "loading shared collection failed", detail: message });
    }
  });

  /** GET /api/collections/:id — read one (owner or public). */
  app.get("/api/collections/:id", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const collection = store.get(req.params.id);
      if (!collection) {
        res.status(404).json({ error: "Not found", detail: `No collection ${req.params.id}` });
        return;
      }
      if (collection.owner !== owner && collection.visibility !== "public") {
        res.status(403).json({ error: "Forbidden", detail: "This collection is private" });
        return;
      }
      res.json({ collection });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error loading collection:", error);
      res.status(500).json({ error: "loading collection failed", detail: message });
    }
  });

  /** PATCH /api/collections/:id — update metadata (title/description/visibility). */
  app.patch("/api/collections/:id", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const patch = normalizePatch(req.body ?? {});
      if (patch.title !== undefined && patch.title.trim() === "") {
        res.status(400).json({ error: "invalid collection", errors: ["title cannot be empty"] });
        return;
      }
      const collection = store.update(req.params.id, patch, owner);
      if (!collection) {
        res.status(404).json({ error: "Not found", detail: `No collection ${req.params.id}` });
        return;
      }
      res.json({ collection });
    } catch (error) {
      if (error instanceof CollectionAccessError) {
        res.status(403).json({ error: "Forbidden", detail: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error updating collection:", error);
      res.status(500).json({ error: "updating collection failed", detail: message });
    }
  });

  /** DELETE /api/collections/:id — delete a collection. */
  app.delete("/api/collections/:id", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const removed = store.remove(req.params.id, owner);
      if (!removed) {
        res.status(404).json({ error: "Not found", detail: `No collection ${req.params.id}` });
        return;
      }
      res.json({ ok: true, id: req.params.id });
    } catch (error) {
      if (error instanceof CollectionAccessError) {
        res.status(403).json({ error: "Forbidden", detail: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error deleting collection:", error);
      res.status(500).json({ error: "deleting collection failed", detail: message });
    }
  });

  /** POST /api/collections/:id/items — add an entity (by ref). */
  app.post("/api/collections/:id/items", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const refErrors = validateEntityRef(body);
    if (refErrors.length > 0) {
      res.status(400).json({ error: "invalid entity ref", errors: refErrors });
      return;
    }
    try {
      const owner = resolveOwner(req);
      const note = typeof body.note === "string" ? body.note : undefined;
      const collection = store.addItem(
        req.params.id,
        { type: body.type as string, id: body.id as string, name: body.name as string | undefined, region: body.region as string | undefined },
        note,
        owner,
      );
      if (!collection) {
        res.status(404).json({ error: "Not found", detail: `No collection ${req.params.id}` });
        return;
      }
      res.json({ collection });
    } catch (error) {
      if (error instanceof CollectionAccessError) {
        res.status(403).json({ error: "Forbidden", detail: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error adding collection item:", error);
      res.status(500).json({ error: "adding collection item failed", detail: message });
    }
  });

  /** DELETE /api/collections/:id/items/:stableId — remove an entity by stable id. */
  app.delete("/api/collections/:id/items/:stableId", (req: Request, res: Response) => {
    try {
      const owner = resolveOwner(req);
      const collection = store.removeItem(req.params.id, req.params.stableId, owner);
      if (!collection) {
        res.status(404).json({ error: "Not found", detail: `No collection ${req.params.id}` });
        return;
      }
      res.json({ collection });
    } catch (error) {
      if (error instanceof CollectionAccessError) {
        res.status(403).json({ error: "Forbidden", detail: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error removing collection item:", error);
      res.status(500).json({ error: "removing collection item failed", detail: message });
    }
  });
}
