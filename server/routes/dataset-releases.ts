/**
 * Versioned public dataset API (US-011)
 *
 * Formalizes citable, versioned snapshots of the whole open corpus and a
 * full-dataset download endpoint:
 *
 *   GET  /api/dataset/release   → release metadata only (version, DOI, license, row counts)
 *   GET  /api/dataset/full      → full-dataset access/download (all profiles + metadata)
 *   POST /api/dataset/release   → mint a new versioned release (semver + changelog + DOI)
 *
 * All snapshot building lives in the pure/injectable `services/export-pipeline.ts`;
 * this file only maps HTTP ↔ `buildDatasetSnapshot`. The DOI minter + changelog store
 * are injectable so route tests run without a live network / Zenodo token. Reads are
 * open; the endpoints are documented in the OpenAPI spec (`GET /api/openapi.json`).
 */

import type { Express } from "express";
import {
  buildDatasetSnapshot,
  nullDoiMinter,
  DATASET_RELEASE_VERSION,
  type DoiMinter,
  type ExportFormat,
  type ChangeCounts,
} from "../services/export-pipeline";
import type { ChangelogStore } from "../services/changelog";

export interface DatasetReleaseRouteOptions {
  /** DOI minter used by `POST /api/dataset/release` (default: no-op, so DOI stays null). */
  doiMinter?: DoiMinter;
  /** Changelog store used to derive the next semver version from recorded changes. */
  changelog?: ChangelogStore;
}

const VALID_FORMATS: ExportFormat[] = ["cldf", "csv", "tsv", "json"];

function parseFormat(raw: unknown): ExportFormat {
  const f = typeof raw === "string" ? raw : "";
  return (VALID_FORMATS as string[]).includes(f) ? (f as ExportFormat) : "json";
}

/** Accept a comma-separated string (query) or an array (JSON body); undefined ⇒ all profiles. */
function parseDatasets(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const arr = raw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : undefined;
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function registerDatasetReleaseRoutes(
  app: Express,
  options: DatasetReleaseRouteOptions = {}
): void {
  const doiMinter = options.doiMinter ?? nullDoiMinter;
  const changelog = options.changelog;

  /**
   * GET /api/dataset/release — versioned release metadata only (no file contents):
   * version, DOI, license, per-dataset + total row counts.
   */
  app.get("/api/dataset/release", async (req, res) => {
    try {
      const snapshot = await buildDatasetSnapshot({
        format: parseFormat(req.query.format),
        datasets: parseDatasets(req.query.datasets),
      });
      res.json(snapshot.metadata);
    } catch (error) {
      res
        .status(400)
        .json({ message: errorMessage(error, "Failed to build release metadata") });
    }
  });

  /**
   * GET /api/dataset/full — full-dataset access/download: every dataset profile
   * bundled with the release metadata, streamed as a downloadable JSON attachment.
   */
  app.get("/api/dataset/full", async (req, res) => {
    try {
      const snapshot = await buildDatasetSnapshot({
        format: parseFormat(req.query.format),
        datasets: parseDatasets(req.query.datasets),
      });
      const filename = `linguascrape-dataset-v${snapshot.metadata.version}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      res
        .status(400)
        .json({ message: errorMessage(error, "Failed to build dataset download") });
    }
  });

  /**
   * POST /api/dataset/release — mint a new versioned release. The next semver
   * version is derived from the recorded changelog since the previous version
   * (removals ⇒ major, additions ⇒ minor, else patch) unless an explicit `version`
   * is supplied; a DOI is minted via the injected minter when configured.
   * Body: { version?, previousVersion?, format?, datasets? }.
   */
  app.post("/api/dataset/release", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const version = typeof body.version === "string" ? body.version : undefined;
      const previousVersion =
        typeof body.previousVersion === "string"
          ? body.previousVersion
          : DATASET_RELEASE_VERSION;

      let changeCounts: ChangeCounts | undefined;
      if (!version && changelog) {
        const stats = changelog.stats();
        changeCounts = {
          added: stats.byChangeType.added,
          modified: stats.byChangeType.modified,
          removed: stats.byChangeType.removed,
        };
      }

      const snapshot = await buildDatasetSnapshot({
        format: parseFormat(body.format),
        datasets: parseDatasets(body.datasets),
        version,
        previousVersion,
        changeCounts,
        doiMinter,
      });
      res.status(201).json(snapshot.metadata);
    } catch (error) {
      res
        .status(400)
        .json({ message: errorMessage(error, "Failed to mint dataset release") });
    }
  });
}
