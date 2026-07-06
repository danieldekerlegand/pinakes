import { describe, it, expect } from "vitest";
import {
  parseSemver,
  formatSemver,
  bumpVersion,
  determineVersionBump,
  nextVersionFromChangelog,
  assembleSnapshotMetadata,
  buildDatasetSnapshot,
  createZenodoDoiMinter,
  nullDoiMinter,
  DATASET_RELEASE_VERSION,
  DATASET_LICENSE,
  getDatasetProfiles,
  type ExportResult,
  type DoiMinter,
} from "./export-pipeline";

// ============================================================================
// Semver + changelog-driven versioning (pure)
// ============================================================================

describe("semver helpers", () => {
  it("parses and formats a valid semver", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("  10.0.9 ")).toEqual({ major: 10, minor: 0, patch: 9 });
    expect(formatSemver({ major: 2, minor: 5, patch: 1 })).toBe("2.5.1");
  });

  it("returns null on a malformed semver", () => {
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("v1.2.3")).toBeNull();
    expect(parseSemver("abc")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });

  it("bumps the right component and resets lower ones", () => {
    expect(bumpVersion("1.4.9", "major")).toBe("2.0.0");
    expect(bumpVersion("1.4.9", "minor")).toBe("1.5.0");
    expect(bumpVersion("1.4.9", "patch")).toBe("1.4.10");
  });

  it("throws when bumping a malformed version", () => {
    expect(() => bumpVersion("nope", "patch")).toThrow(/Invalid semver/);
  });
});

describe("determineVersionBump", () => {
  it("removals ⇒ major, additions ⇒ minor, else patch", () => {
    expect(determineVersionBump({ added: 5, modified: 2, removed: 1 })).toBe("major");
    expect(determineVersionBump({ added: 5, modified: 2, removed: 0 })).toBe("minor");
    expect(determineVersionBump({ added: 0, modified: 3, removed: 0 })).toBe("patch");
    expect(determineVersionBump({ added: 0, modified: 0, removed: 0 })).toBe("patch");
  });

  it("nextVersionFromChangelog composes the bump onto the previous version", () => {
    expect(nextVersionFromChangelog("1.2.0", { added: 3, modified: 0, removed: 0 })).toBe("1.3.0");
    expect(nextVersionFromChangelog("1.2.0", { added: 0, modified: 0, removed: 4 })).toBe("2.0.0");
    expect(nextVersionFromChangelog("1.2.0", { added: 0, modified: 1, removed: 0 })).toBe("1.2.1");
  });
});

// ============================================================================
// Snapshot metadata assembly (pure)
// ============================================================================

function fakeExport(dataset: string, name: string, rowCounts: number[]): ExportResult {
  return {
    dataset,
    format: "json",
    files: rowCounts.map((rowCount, i) => ({
      filename: `${dataset}-${i}.json`,
      content: "[]",
      rowCount,
    })),
    metadata: {
      title: `LinguaScrape Export: ${name}`,
      description: "",
      exportDate: "2026-01-01T00:00:00.000Z",
      source: "LinguaScrape",
      license: DATASET_LICENSE,
      fileCount: rowCounts.length,
      totalRows: rowCounts.reduce((a, b) => a + b, 0),
    },
  };
}

describe("assembleSnapshotMetadata", () => {
  it("aggregates per-dataset and total row/file counts with version + license", () => {
    const meta = assembleSnapshotMetadata(
      [fakeExport("languages", "Languages", [10, 5]), fakeExport("grammar", "Grammatical Features", [7])],
      { version: "3.1.0", releaseDate: "2026-07-06T00:00:00.000Z", format: "json" }
    );

    expect(meta.version).toBe("3.1.0");
    expect(meta.releaseDate).toBe("2026-07-06T00:00:00.000Z");
    expect(meta.license).toBe(DATASET_LICENSE);
    expect(meta.doi).toBeNull();
    expect(meta.doiUrl).toBeNull();
    expect(meta.format).toBe("json");
    expect(meta.datasets).toEqual([
      { id: "languages", name: "Languages", fileCount: 2, totalRows: 15 },
      { id: "grammar", name: "Grammatical Features", fileCount: 1, totalRows: 7 },
    ]);
    expect(meta.fileCount).toBe(3);
    expect(meta.totalRows).toBe(22);
  });

  it("honours an explicit license + DOI override", () => {
    const meta = assembleSnapshotMetadata([fakeExport("languages", "Languages", [1])], {
      version: "1.0.0",
      releaseDate: "2026-07-06T00:00:00.000Z",
      format: "csv",
      license: "CC0-1.0",
      doi: "10.5281/zenodo.123",
      doiUrl: "https://doi.org/10.5281/zenodo.123",
    });
    expect(meta.license).toBe("CC0-1.0");
    expect(meta.doi).toBe("10.5281/zenodo.123");
    expect(meta.doiUrl).toBe("https://doi.org/10.5281/zenodo.123");
  });
});

// ============================================================================
// buildDatasetSnapshot (integration over the real lexicons corpus)
// ============================================================================

describe("buildDatasetSnapshot", () => {
  it("bundles every profile with a default version and metadata row counts matching files", async () => {
    const snapshot = await buildDatasetSnapshot({
      format: "json",
      releaseDate: "2026-07-06T00:00:00.000Z",
    });

    expect(snapshot.metadata.version).toBe(DATASET_RELEASE_VERSION);
    expect(snapshot.metadata.releaseDate).toBe("2026-07-06T00:00:00.000Z");
    expect(snapshot.metadata.license).toBe(DATASET_LICENSE);
    expect(snapshot.metadata.doi).toBeNull();

    // Every configured profile that produced files is represented.
    const profileIds = getDatasetProfiles().map((p) => p.id);
    for (const entry of snapshot.metadata.datasets) {
      expect(profileIds).toContain(entry.id);
    }

    // Totals are internally consistent: metadata counts == the bundled files.
    const fileRowTotal = snapshot.files.reduce((s, f) => s + f.rowCount, 0);
    expect(snapshot.metadata.totalRows).toBe(fileRowTotal);
    expect(snapshot.metadata.fileCount).toBe(snapshot.files.length);
    expect(snapshot.metadata.totalRows).toBeGreaterThan(0);
  });

  it("restricts to a subset of datasets", async () => {
    const snapshot = await buildDatasetSnapshot({ datasets: ["languages"] });
    expect(snapshot.metadata.datasets.map((d) => d.id)).toEqual(["languages"]);
    expect(snapshot.files.every((f) => f.dataset === "languages")).toBe(true);
  });

  it("derives the next version from previousVersion + changeCounts", async () => {
    const snapshot = await buildDatasetSnapshot({
      datasets: ["languages"],
      previousVersion: "2.4.0",
      changeCounts: { added: 3, modified: 0, removed: 0 },
    });
    expect(snapshot.metadata.version).toBe("2.5.0");
  });

  it("an explicit version overrides changelog derivation", async () => {
    const snapshot = await buildDatasetSnapshot({
      datasets: ["languages"],
      version: "9.9.9",
      previousVersion: "2.4.0",
      changeCounts: { added: 3, modified: 0, removed: 0 },
    });
    expect(snapshot.metadata.version).toBe("9.9.9");
  });

  it("stamps a DOI from the injected minter", async () => {
    const minter: DoiMinter = {
      async mint(meta) {
        return { doi: `10.5281/zenodo.${meta.version}`, doiUrl: "https://doi.org/x" };
      },
    };
    const snapshot = await buildDatasetSnapshot({
      datasets: ["languages"],
      version: "1.0.0",
      doiMinter: minter,
    });
    expect(snapshot.metadata.doi).toBe("10.5281/zenodo.1.0.0");
    expect(snapshot.metadata.doiUrl).toBe("https://doi.org/x");
  });

  it("leaves DOI null when the minter declines (nullDoiMinter)", async () => {
    const snapshot = await buildDatasetSnapshot({
      datasets: ["languages"],
      doiMinter: nullDoiMinter,
    });
    expect(snapshot.metadata.doi).toBeNull();
  });
});

// ============================================================================
// Zenodo DOI minter (injectable fetch — no live network)
// ============================================================================

describe("createZenodoDoiMinter", () => {
  const meta = {
    title: "LinguaScrape Open Dataset",
    description: "d",
    version: "1.0.0",
    releaseDate: "2026-07-06T00:00:00.000Z",
    doi: null,
    doiUrl: null,
    license: "CC-BY-4.0",
    source: "LinguaScrape",
    format: "json" as const,
    datasets: [],
    fileCount: 0,
    totalRows: 0,
  };

  it("returns null (minting disabled) when no token is configured", async () => {
    const minter = createZenodoDoiMinter({ token: "", fetchImpl: (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch });
    expect(await minter.mint(meta)).toBeNull();
  });

  it("reserves a DOI via the deposition API when a token is present", async () => {
    const fetchImpl = (async (url: string) => {
      expect(String(url)).toContain("/api/deposit/depositions");
      return {
        ok: true,
        async json() {
          return { metadata: { prereserve_doi: { doi: "10.5281/zenodo.42" } } };
        },
      };
    }) as unknown as typeof fetch;

    const minter = createZenodoDoiMinter({ token: "tkn", fetchImpl });
    expect(await minter.mint(meta)).toEqual({
      doi: "10.5281/zenodo.42",
      doiUrl: "https://doi.org/10.5281/zenodo.42",
    });
  });

  it("throws on a non-ok Zenodo response", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401, async json() {
      return {};
    } })) as unknown as typeof fetch;
    const minter = createZenodoDoiMinter({ token: "tkn", fetchImpl });
    await expect(minter.mint(meta)).rejects.toThrow(/Zenodo DOI minting failed: 401/);
  });
});
