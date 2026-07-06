/**
 * Drawn-geometry authoring route (US-001).
 *
 * `POST /api/map/drawn-geometry` accepts a geometry drawn on the map (a GeoJSON
 * Polygon or LineString) plus its entity/time association, and lands it in the
 * *contribution review queue* with provenance `source = 'user-drawn'` — it never
 * writes the source-of-truth TSVs directly (a reviewer promotes it, US-009).
 *
 * The `ContributionService` is injectable so tests can point it at a temp dir
 * (see `server/routes/collections.test.ts` for the pattern).
 */

import type { Express } from "express";
import { ContributionService } from "../services/contribution-service";
import {
  validateDrawnGeometry,
  drawnGeometryToContribution,
  DRAWN_GEOMETRY_TARGETS,
  type DrawnGeometryInput,
} from "../services/drawn-geometry";

export function registerDrawnGeometryRoutes(
  app: Express,
  contributions: ContributionService = new ContributionService(),
): void {
  /**
   * POST /api/map/drawn-geometry
   * Body: DrawnGeometryInput. Returns 201 with the queued contribution, or 400
   * with validation errors.
   */
  app.post("/api/map/drawn-geometry", (req, res) => {
    try {
      const input = req.body as Partial<DrawnGeometryInput>;

      const validation = validateDrawnGeometry(input);
      if (!validation.valid) {
        return res.status(400).json({
          message: "Invalid drawn geometry",
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      const { contribution, validation: contribValidation } = contributions.submit(
        drawnGeometryToContribution(input as DrawnGeometryInput),
      );

      if (!contribution) {
        return res.status(400).json({
          message: "Invalid drawn geometry",
          errors: contribValidation.errors,
          warnings: contribValidation.warnings,
        });
      }

      return res.status(201).json({
        contribution,
        warnings: [...validation.warnings, ...contribValidation.warnings],
      });
    } catch (error) {
      console.error("Error submitting drawn geometry:", error);
      return res.status(500).json({ message: "Failed to submit drawn geometry" });
    }
  });

  /**
   * GET /api/map/drawn-geometry/targets — the valid drawing targets, for the
   * client's target selector.
   */
  app.get("/api/map/drawn-geometry/targets", (_req, res) => {
    res.json({ targets: DRAWN_GEOMETRY_TARGETS });
  });
}
