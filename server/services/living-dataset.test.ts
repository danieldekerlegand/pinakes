import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LivingDatasetStore,
  computeReleaseCadence,
  computeIngestionSchedule,
  selectDueDomains,
  currentReleaseFrom,
  RELEASE_CADENCE_DAYS,
  INGESTION_INTERVAL_DAYS,
  type ReleaseRecord,
} from "./living-dataset";
import { assembleSnapshotMetadata } from "./export-pipeline";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-06T00:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

describe("computeReleaseCadence (annual)", () => {
  it("is due immediately when the corpus has never been released", () => {
    const c = computeReleaseCadence(null, NOW);
    expect(c.cadence).toBe("annual");
    expect(c.intervalDays).toBe(RELEASE_CADENCE_DAYS);
    expect(c.dueNow).toBe(true);
    expect(c.nextReleaseDate).toBeNull();
    expect(c.daysUntilDue).toBeNull();
  });

  it("treats an unparseable last-release date as due", () => {
    const c = computeReleaseCadence("not-a-date", NOW);
    expect(c.dueNow).toBe(true);
    expect(c.nextReleaseDate).toBeNull();
  });

  it("is not due within the annual window and reports days remaining", () => {
    const c = computeReleaseCadence(daysAgo(100), NOW);
    expect(c.dueNow).toBe(false);
    expect(c.daysUntilDue).toBe(RELEASE_CADENCE_DAYS - 100);
    expect(c.nextReleaseDate).toBe(
      new Date(NOW.getTime() + (RELEASE_CADENCE_DAYS - 100) * DAY_MS).toISOString(),
    );
  });

  it("is due once a full year has elapsed (overdue ⇒ negative days)", () => {
    const c = computeReleaseCadence(daysAgo(400), NOW);
    expect(c.dueNow).toBe(true);
    expect(c.daysUntilDue).toBeLessThan(0);
  });
});

describe("computeIngestionSchedule", () => {
  it("marks every domain due when nothing has been ingested", () => {
    const schedule = computeIngestionSchedule({}, NOW);
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.every((e) => e.dueNow)).toBe(true);
    expect(schedule.every((e) => e.lastIngested === null)).toBe(true);
    expect(selectDueDomains(schedule).sort()).toEqual(
      schedule.map((e) => e.domain).sort(),
    );
  });

  it("keeps a freshly-ingested domain out of the due set but stales an old one", () => {
    const schedule = computeIngestionSchedule(
      {
        civilizations: daysAgo(2), // fresh
        sites: daysAgo(INGESTION_INTERVAL_DAYS + 5), // stale
      },
      NOW,
    );
    const civ = schedule.find((e) => e.domain === "civilizations")!;
    const sites = schedule.find((e) => e.domain === "sites")!;
    expect(civ.dueNow).toBe(false);
    expect(civ.daysSinceLastIngest).toBe(2);
    expect(sites.dueNow).toBe(true);
    const due = selectDueDomains(schedule);
    expect(due).toContain("sites");
    expect(due).not.toContain("civilizations");
  });

  it("treats an unparseable ingestion timestamp as due", () => {
    const schedule = computeIngestionSchedule({ figures: "garbage" }, NOW);
    const figures = schedule.find((e) => e.domain === "figures")!;
    expect(figures.dueNow).toBe(true);
    expect(figures.lastIngested).toBeNull();
  });
});

describe("currentReleaseFrom", () => {
  it("returns the seed default when nothing has been released", () => {
    const c = currentReleaseFrom([]);
    expect(c.released).toBe(false);
    expect(c.version).toBe("1.0.0");
    expect(c.releaseDate).toBeNull();
  });

  it("returns the latest recorded release", () => {
    const releases: ReleaseRecord[] = [
      { version: "1.0.0", doi: null, doiUrl: null, releaseDate: daysAgo(400), totalRows: 10, license: "CC-BY-4.0" },
      { version: "1.1.0", doi: "10.5281/zenodo.1.1.0", doiUrl: "https://doi.org/10.5281/zenodo.1.1.0", releaseDate: daysAgo(5), totalRows: 20, license: "CC-BY-4.0" },
    ];
    const c = currentReleaseFrom(releases);
    expect(c.released).toBe(true);
    expect(c.version).toBe("1.1.0");
    expect(c.doi).toBe("10.5281/zenodo.1.1.0");
    expect(c.totalRows).toBe(20);
  });
});

describe("snapshot metadata assembly (release payload)", () => {
  it("sums per-dataset rows/files into the release totals", () => {
    const meta = assembleSnapshotMetadata(
      [
        {
          dataset: "languages",
          format: "json",
          files: [
            { filename: "languages.json", content: "[]", rowCount: 3 },
            { filename: "families.json", content: "[]", rowCount: 2 },
          ],
          metadata: {
            title: "Pinakes Export: Languages",
            description: "",
            exportDate: NOW.toISOString(),
            source: "",
            license: "CC-BY-4.0",
            fileCount: 2,
            totalRows: 5,
          },
        },
      ],
      { version: "2.0.0", releaseDate: NOW.toISOString(), format: "json" },
    );
    expect(meta.version).toBe("2.0.0");
    expect(meta.fileCount).toBe(2);
    expect(meta.totalRows).toBe(5);
    expect(meta.datasets[0].id).toBe("languages");
    expect(meta.datasets[0].name).toBe("Languages");
    expect(meta.doi).toBeNull();
  });
});

describe("LivingDatasetStore", () => {
  it("persists ingestion timestamps + release history across reads", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "living-dataset-"));
    try {
      const store = new LivingDatasetStore(dir);
      expect(store.getIngestions()).toEqual({});
      expect(store.getReleases()).toEqual([]);

      store.recordIngestion("civilizations", daysAgo(1));
      store.recordIngestion("sites", daysAgo(2));
      const release: ReleaseRecord = {
        version: "1.1.0",
        doi: null,
        doiUrl: null,
        releaseDate: NOW.toISOString(),
        totalRows: 42,
        license: "CC-BY-4.0",
      };
      store.recordRelease(release);

      // A fresh instance re-reads from disk.
      const reopened = new LivingDatasetStore(dir);
      expect(reopened.getIngestions().civilizations).toBe(daysAgo(1));
      expect(reopened.getIngestions().sites).toBe(daysAgo(2));
      expect(reopened.getReleases()).toEqual([release]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers from a missing/corrupt state file as empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "living-dataset-"));
    try {
      fs.writeFileSync(path.join(dir, "state.json"), "{ not json", "utf-8");
      const store = new LivingDatasetStore(dir);
      expect(store.getIngestions()).toEqual({});
      expect(store.getReleases()).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
