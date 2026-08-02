/**
 * Living-dataset lifecycle (US-011 — speculative PRD).
 *
 * The "living dataset" is the workflow layer that keeps the corpus current and
 * academically citable over time. It has three moving parts, each of which
 * *composes* an existing building block rather than reinventing it:
 *
 *   1. **Discovery ingestion** — a scheduled, incremental refresh that picks up
 *      newly-published discoveries via culture-scrape's bulk acquisition
 *      (`culturescrape-acquisition.ts`), landing every acquired record in the
 *      contribution review queue (never a live write). This module decides *which*
 *      acquisition domains are stale enough to re-ingest (mirroring
 *      culture-scrape's own `orchestrate/schedule.py` `select_stale` staleness
 *      idea) against a per-domain "last ingested" timestamp.
 *   2. **Annual release cadence** — periodic, versioned, DOI-bearing snapshots of
 *      the whole corpus (`export-pipeline.ts` `buildDatasetSnapshot`). This module
 *      decides *when* the next annual release is due against the last release date.
 *   3. **Freshness/versioning status** — a composed view over `data-freshness.ts`
 *      (per-file staleness) + the ingestion schedule + the release cadence, surfaced
 *      in the UI.
 *
 * All the decision logic here is **pure** (clock is a param, no fs/express/network)
 * so it is unit-tested directly. The only fs boundary is {@link LivingDatasetStore},
 * a tiny JSON-per-state store (same shape as the other `data/*` stores) that records
 * the per-domain ingestion timestamps + the release history the pure functions grade
 * against.
 */

import fs from "node:fs";
import path from "node:path";

import {
  ACQUISITION_CATALOG,
  type AcquisitionDomain,
} from "./culturescrape-acquisition";
import { DATASET_LICENSE, DATASET_RELEASE_VERSION } from "./export-pipeline";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Annual release cadence — the living dataset produces a citable snapshot yearly. */
export const RELEASE_CADENCE_DAYS = 365;

/**
 * Default discovery-ingestion refresh window: a domain that has not been ingested
 * for this long is "stale" and selected for a scheduled re-ingestion run.
 */
export const INGESTION_INTERVAL_DAYS = 30;

export type ReleaseCadenceName = "annual";

// ── Release cadence ────────────────────────────────────────────────────────────

export interface ReleaseCadence {
  cadence: ReleaseCadenceName;
  intervalDays: number;
  lastReleaseDate: string | null;
  nextReleaseDate: string | null;
  /** Whether a new release is due at `now`. */
  dueNow: boolean;
  /** Whole days until the next release is due; negative when overdue, null when never released. */
  daysUntilDue: number | null;
}

/**
 * Decide whether an annual release is due. A corpus that has never been released
 * (or whose last release date is unparseable) is always due — the first release
 * should ship. Otherwise the next release date is `lastReleaseDate + intervalDays`
 * and the release is due once `now` reaches it.
 */
export function computeReleaseCadence(
  lastReleaseDate: string | null,
  now: Date,
  intervalDays: number = RELEASE_CADENCE_DAYS,
): ReleaseCadence {
  const neverReleased: ReleaseCadence = {
    cadence: "annual",
    intervalDays,
    lastReleaseDate: lastReleaseDate ?? null,
    nextReleaseDate: null,
    dueNow: true,
    daysUntilDue: null,
  };
  if (!lastReleaseDate) return neverReleased;

  const last = new Date(lastReleaseDate);
  if (Number.isNaN(last.getTime())) return neverReleased;

  const next = new Date(last.getTime() + intervalDays * DAY_MS);
  return {
    cadence: "annual",
    intervalDays,
    lastReleaseDate: last.toISOString(),
    nextReleaseDate: next.toISOString(),
    dueNow: now.getTime() >= next.getTime(),
    daysUntilDue: Math.ceil((next.getTime() - now.getTime()) / DAY_MS),
  };
}

// ── Discovery-ingestion schedule ────────────────────────────────────────────────

export interface IngestionScheduleEntry {
  domain: AcquisitionDomain;
  label: string;
  lastIngested: string | null;
  nextDue: string | null;
  /** Whether this domain is stale enough to re-ingest at `now`. */
  dueNow: boolean;
  daysSinceLastIngest: number | null;
}

/**
 * Grade every acquisition domain against its recorded last-ingestion timestamp: a
 * domain never ingested (or with an unparseable timestamp) is due; otherwise it is
 * due once `intervalDays` have elapsed since the last ingestion. Preserves catalog
 * order so the schedule reads sensibly.
 */
export function computeIngestionSchedule(
  ingestions: Record<string, string>,
  now: Date,
  intervalDays: number = INGESTION_INTERVAL_DAYS,
): IngestionScheduleEntry[] {
  return Object.values(ACQUISITION_CATALOG).map((cat) => {
    const raw = ingestions[cat.domain];
    const last = raw ? new Date(raw) : null;
    if (!last || Number.isNaN(last.getTime())) {
      return {
        domain: cat.domain,
        label: cat.label,
        lastIngested: null,
        nextDue: null,
        dueNow: true,
        daysSinceLastIngest: null,
      };
    }
    const next = new Date(last.getTime() + intervalDays * DAY_MS);
    return {
      domain: cat.domain,
      label: cat.label,
      lastIngested: last.toISOString(),
      nextDue: next.toISOString(),
      dueNow: now.getTime() >= next.getTime(),
      daysSinceLastIngest: Math.floor((now.getTime() - last.getTime()) / DAY_MS),
    };
  });
}

/** The domains selected for refresh by a scheduled ingestion run, in catalog order. */
export function selectDueDomains(
  schedule: IngestionScheduleEntry[],
): AcquisitionDomain[] {
  return schedule.filter((e) => e.dueNow).map((e) => e.domain);
}

// ── Release history + current release ────────────────────────────────────────────

export interface ReleaseRecord {
  version: string;
  doi: string | null;
  doiUrl: string | null;
  releaseDate: string;
  totalRows: number;
  license: string;
}

export interface CurrentRelease {
  version: string;
  doi: string | null;
  doiUrl: string | null;
  releaseDate: string | null;
  totalRows: number | null;
  license: string;
  /** False when no release has been minted yet — the version is the seed default. */
  released: boolean;
}

/** The latest recorded release, or the seed defaults when nothing has been released. */
export function currentReleaseFrom(releases: ReleaseRecord[]): CurrentRelease {
  const latest = releases.length ? releases[releases.length - 1] : null;
  if (!latest) {
    return {
      version: DATASET_RELEASE_VERSION,
      doi: null,
      doiUrl: null,
      releaseDate: null,
      totalRows: null,
      license: DATASET_LICENSE,
      released: false,
    };
  }
  return {
    version: latest.version,
    doi: latest.doi,
    doiUrl: latest.doiUrl,
    releaseDate: latest.releaseDate,
    totalRows: latest.totalRows,
    license: latest.license,
    released: true,
  };
}

// ── Persistence (the fs boundary) ────────────────────────────────────────────────

interface LivingDatasetState {
  /** Per-domain last-ingestion timestamp (ISO) keyed by acquisition domain. */
  ingestions: Record<string, string>;
  /** Chronological release history (append-only). */
  releases: ReleaseRecord[];
}

/**
 * JSON-on-disk store of the living-dataset state — the per-domain ingestion
 * timestamps + the release history the pure functions grade against. One
 * `state.json` under an injectable dir (default the gitignored
 * `data/living-dataset/`), same JSON-file shape as the other `data/*` stores.
 */
export class LivingDatasetStore {
  private readonly file: string;

  constructor(dataDir: string = "data/runtime/living-dataset") {
    this.file = path.join(dataDir, "state.json");
  }

  private read(): LivingDatasetState {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.file, "utf-8"),
      ) as Partial<LivingDatasetState>;
      return {
        ingestions:
          parsed.ingestions && typeof parsed.ingestions === "object"
            ? (parsed.ingestions as Record<string, string>)
            : {},
        releases: Array.isArray(parsed.releases) ? parsed.releases : [],
      };
    } catch {
      return { ingestions: {}, releases: [] };
    }
  }

  private write(state: LivingDatasetState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2), "utf-8");
  }

  getIngestions(): Record<string, string> {
    return this.read().ingestions;
  }

  getReleases(): ReleaseRecord[] {
    return this.read().releases;
  }

  /** Record a scheduled ingestion of `domain` at `at` (ISO). */
  recordIngestion(domain: string, at: string): void {
    const state = this.read();
    state.ingestions[domain] = at;
    this.write(state);
  }

  /** Append a minted release to the history. */
  recordRelease(record: ReleaseRecord): void {
    const state = this.read();
    state.releases.push(record);
    this.write(state);
  }
}
