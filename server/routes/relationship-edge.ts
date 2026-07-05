/**
 * Relationship-builder authoring route (US-003).
 *
 * `POST /api/relationships/edge` accepts a typed edge authored by dragging one
 * entity onto another (source, target, relationship_type, time range,
 * confidence), and lands it in the *contribution review queue* with provenance
 * `source = 'user-authored'` — it never writes `cultural-lineages.tsv` directly
 * (a reviewer promotes it, US-009).
 *
 * Dedup is enforced server-side against **both** the existing canonical edges of
 * the corpus (`extractAllCanonicalEdges`, US-003) and the relationships already
 * sitting in the queue, so a duplicate `(source, target, type)` triple is
 * rejected regardless of where the prior edge lives. Self edges are rejected in
 * the pure validator.
 *
 * The `ContributionService` + lexicons dir are injectable so tests can point
 * them at temp dirs (see `server/routes/timeline-event.test.ts` for the pattern).
 */

import type { Express } from "express";
import path from "node:path";
import { ContributionService } from "../services/contribution-service";
import { extractAllCanonicalEdges } from "../services/canonical-edges";
import {
  validateRelationshipEdge,
  relationshipEdgeToContribution,
  relationshipSummary,
  RELATIONSHIP_TYPE_OPTIONS,
  type RelationshipEdgeInput,
  type ExistingEdge,
} from "../services/relationship-edge";

export interface RelationshipRouteOptions {
  /** Contribution queue (default: real `data/contributions`). */
  contributions?: ContributionService;
  /** Lexicons dir the corpus edges are read from (default: `./lexicons`). */
  lexiconsDir?: string;
}

/**
 * The relationships already present, for dedup: the corpus's canonical edges
 * plus every queued `relationship` contribution (any status — a pending or
 * rejected duplicate is still a collision worth flagging).
 */
function collectExistingEdges(
  contributions: ContributionService,
  lexiconsDir: string,
): ExistingEdge[] {
  const existing: ExistingEdge[] = [];

  const { edges } = extractAllCanonicalEdges(lexiconsDir);
  for (const e of edges) {
    existing.push({
      sourceId: e.startId,
      targetId: e.endId,
      relationshipType: e.edgeName,
    });
  }

  const queued = contributions.list({ entityType: "relationship", limit: 100000 }).contributions;
  for (const c of queued) {
    const d = c.entityData as Record<string, unknown>;
    if (
      typeof d.sourceId === "string" &&
      typeof d.targetId === "string" &&
      typeof d.relationshipType === "string"
    ) {
      existing.push({
        sourceId: d.sourceId,
        targetId: d.targetId,
        relationshipType: d.relationshipType,
      });
    }
  }

  return existing;
}

export function registerRelationshipEdgeRoutes(
  app: Express,
  options: RelationshipRouteOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();
  const lexiconsDir = options.lexiconsDir ?? path.resolve("lexicons");

  /**
   * POST /api/relationships/edge
   * Body: RelationshipEdgeInput. Returns 201 with the queued contribution and a
   * `relationship` confirmation summary, 409 on a duplicate, or 400 on other
   * validation errors.
   */
  app.post("/api/relationships/edge", (req, res) => {
    try {
      const input = req.body as Partial<RelationshipEdgeInput>;
      const existing = collectExistingEdges(contributions, lexiconsDir);

      const validation = validateRelationshipEdge(input, existing);
      if (!validation.valid) {
        return res.status(validation.duplicate ? 409 : 400).json({
          message: validation.duplicate ? "Duplicate relationship" : "Invalid relationship",
          errors: validation.errors,
          warnings: validation.warnings,
          duplicate: validation.duplicate ?? false,
        });
      }

      const { contribution, validation: contribValidation } = contributions.submit(
        relationshipEdgeToContribution(input as RelationshipEdgeInput),
      );

      if (!contribution) {
        return res.status(400).json({
          message: "Invalid relationship",
          errors: contribValidation.errors,
          warnings: contribValidation.warnings,
        });
      }

      return res.status(201).json({
        contribution,
        relationship: relationshipSummary(input as RelationshipEdgeInput),
        warnings: [...validation.warnings, ...contribValidation.warnings],
      });
    } catch (error) {
      console.error("Error submitting relationship:", error);
      return res.status(500).json({ message: "Failed to submit relationship" });
    }
  });

  /**
   * GET /api/relationships/edge/options — the canonical relationship-type
   * vocabulary the client's builder needs, plus the existing `(source, target,
   * type)` triples so the UI can pre-empt duplicates before submitting.
   */
  app.get("/api/relationships/edge/options", (_req, res) => {
    try {
      const existing = collectExistingEdges(contributions, lexiconsDir);
      res.json({
        relationshipTypes: RELATIONSHIP_TYPE_OPTIONS,
        existingEdges: existing,
      });
    } catch (error) {
      console.error("Error loading relationship options:", error);
      res.status(500).json({ message: "Failed to load relationship options" });
    }
  });
}
