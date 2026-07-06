import fs from "node:fs";
import path from "node:path";

const LEXICONS_DIR = path.resolve("lexicons");

/** Supported export formats for open dataset contribution */
export type ExportFormat = "cldf" | "csv" | "tsv" | "json";

/** A dataset category that groups related TSV files */
export interface DatasetProfile {
  id: string;
  name: string;
  description: string;
  files: string[];
  /** Column mappings from internal names to standard names per file */
  columnMappings: Record<string, Record<string, string>>;
}

export interface ExportOptions {
  /** Which dataset profile to export */
  dataset: string;
  /** Output format */
  format: ExportFormat;
  /** Optional filter: only include rows where column matches value */
  filters?: Record<string, string>;
  /** Which files within the dataset to include (default: all) */
  includeFiles?: string[];
}

export interface ExportResult {
  dataset: string;
  format: ExportFormat;
  files: ExportedFile[];
  metadata: DatasetMetadata;
}

export interface ExportedFile {
  filename: string;
  content: string;
  rowCount: number;
}

export interface DatasetMetadata {
  title: string;
  description: string;
  exportDate: string;
  source: string;
  license: string;
  fileCount: number;
  totalRows: number;
}

/** Dataset profiles define how internal data maps to open dataset standards */
const DATASET_PROFILES: DatasetProfile[] = [
  {
    id: "languages",
    name: "Languages",
    description: "Core language catalog with ISO codes, classification, and geographic data",
    files: ["languages.tsv", "families.tsv"],
    columnMappings: {
      "languages.tsv": {
        id: "ID",
        name: "Name",
        iso639_1: "ISO639P1code",
        iso639_2: "ISO639P3code",
        family_id: "Family_ID",
        latitude: "Latitude",
        longitude: "Longitude",
        status: "Status",
        region: "Macroarea",
        countries: "Countries",
        native_speakers: "Speakers",
        classification: "Classification",
      },
      "families.tsv": {
        id: "ID",
        name: "Name",
        region: "Macroarea",
      },
    },
  },
  {
    id: "phonology",
    name: "Phonological Inventories",
    description: "Phoneme inventories and phonological features for PHOIBLE/CLDF contribution",
    files: ["phonological-inventories.tsv", "sound-changes.tsv"],
    columnMappings: {
      "phonological-inventories.tsv": {
        id: "ID",
        language_id: "Language_ID",
        consonants: "Consonants",
        vowels: "Vowels",
        tones: "Tones",
      },
      "sound-changes.tsv": {
        id: "ID",
        source_language: "Source_Language_ID",
        target_language: "Target_Language_ID",
      },
    },
  },
  {
    id: "grammar",
    name: "Grammatical Features",
    description: "Typological features suitable for WALS contribution",
    files: ["grammar-features.tsv"],
    columnMappings: {
      "grammar-features.tsv": {
        id: "ID",
        language_id: "Language_ID",
        word_order: "Word_Order",
        morphological_type: "Morphological_Type",
        case_system: "Case_System",
        gender_system: "Gender_System",
        number_system: "Number_System",
      },
    },
  },
  {
    id: "etymology",
    name: "Etymology Relations",
    description: "Cognate sets and etymological relations for open etymological databases",
    files: ["etymology-relations.tsv", "words-base.tsv"],
    columnMappings: {
      "etymology-relations.tsv": {
        id: "ID",
        source_word: "Source_Form",
        source_language: "Source_Language_ID",
        target_word: "Target_Form",
        target_language: "Target_Language_ID",
        relation_type: "Relation_Type",
      },
      "words-base.tsv": {
        id: "ID",
        concept: "Parameter_ID",
        english: "English",
      },
    },
  },
  {
    id: "writing-systems",
    name: "Writing Systems",
    description: "Script and writing system data",
    files: ["writing-systems.tsv"],
    columnMappings: {
      "writing-systems.tsv": {
        id: "ID",
        name: "Name",
        language_id: "Language_ID",
      },
    },
  },
];

/** Get all available dataset profiles */
export function getDatasetProfiles(): DatasetProfile[] {
  return DATASET_PROFILES;
}

/** Get a specific dataset profile by ID */
export function getDatasetProfile(id: string): DatasetProfile | undefined {
  return DATASET_PROFILES.find((p) => p.id === id);
}

/** Read and parse a TSV file from the lexicons directory */
async function readTsvFile(
  filename: string
): Promise<{ headers: string[]; rows: string[][] }> {
  const filePath = path.join(LEXICONS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { headers: [], rows: [] };
  }
  const content = await fs.promises.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { headers, rows };
}

/** Apply filters to rows based on column values */
function applyFilters(
  headers: string[],
  rows: string[][],
  filters: Record<string, string>
): string[][] {
  if (Object.keys(filters).length === 0) return rows;

  return rows.filter((row) => {
    for (const [col, value] of Object.entries(filters)) {
      const colIdx = headers.indexOf(col);
      if (colIdx === -1) continue;
      const cellValue = (row[colIdx] ?? "").trim().toLowerCase();
      if (!cellValue.includes(value.toLowerCase())) return false;
    }
    return true;
  });
}

/** Remap headers from internal names to standard names using column mappings */
function remapHeaders(
  headers: string[],
  mappings: Record<string, string>
): { mappedHeaders: string[]; indexMap: number[] } {
  const mappedHeaders: string[] = [];
  const indexMap: number[] = [];

  for (let i = 0; i < headers.length; i++) {
    const mapped = mappings[headers[i]];
    if (mapped) {
      mappedHeaders.push(mapped);
      indexMap.push(i);
    } else {
      // Keep unmapped columns with original names
      mappedHeaders.push(headers[i]);
      indexMap.push(i);
    }
  }

  return { mappedHeaders, indexMap };
}

/** Reorder row values according to index map */
function remapRow(row: string[], indexMap: number[]): string[] {
  return indexMap.map((i) => (row[i] ?? "").trim());
}

/** Escape a value for CSV output */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Format rows and headers into the requested format */
function formatOutput(
  headers: string[],
  rows: string[][],
  format: ExportFormat
): string {
  switch (format) {
    case "csv":
      return [
        headers.map(escapeCsv).join(","),
        ...rows.map((r) => r.map(escapeCsv).join(",")),
      ].join("\n");

    case "tsv":
      return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");

    case "json":
      return JSON.stringify(
        rows.map((row) => {
          const obj: Record<string, string> = {};
          for (let i = 0; i < headers.length; i++) {
            obj[headers[i]] = (row[i] ?? "").trim();
          }
          return obj;
        }),
        null,
        2
      );

    case "cldf":
      // CLDF uses CSV with specific conventions
      return [
        headers.map(escapeCsv).join(","),
        ...rows.map((r) => r.map(escapeCsv).join(",")),
      ].join("\n");

    default:
      return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
  }
}

/** Get the file extension for a given format */
function getExtension(format: ExportFormat): string {
  switch (format) {
    case "csv":
    case "cldf":
      return ".csv";
    case "json":
      return ".json";
    case "tsv":
    default:
      return ".tsv";
  }
}

/** Generate metadata for the export */
function generateMetadata(
  profile: DatasetProfile,
  files: ExportedFile[]
): DatasetMetadata {
  return {
    title: `LinguaScrape Export: ${profile.name}`,
    description: profile.description,
    exportDate: new Date().toISOString(),
    source: "LinguaScrape (https://github.com/linguascrape)",
    license: "CC-BY-4.0",
    fileCount: files.length,
    totalRows: files.reduce((sum, f) => sum + f.rowCount, 0),
  };
}

/** Export a dataset in the specified format */
export async function exportDataset(
  options: ExportOptions
): Promise<ExportResult> {
  const profile = getDatasetProfile(options.dataset);
  if (!profile) {
    throw new Error(
      `Unknown dataset: ${options.dataset}. Available: ${DATASET_PROFILES.map((p) => p.id).join(", ")}`
    );
  }

  const filesToExport = options.includeFiles
    ? profile.files.filter((f) => options.includeFiles!.includes(f))
    : profile.files;

  const exportedFiles: ExportedFile[] = [];

  for (const filename of filesToExport) {
    const { headers, rows } = await readTsvFile(filename);
    if (headers.length === 0) continue;

    // Apply filters
    const filteredRows = options.filters
      ? applyFilters(headers, rows, options.filters)
      : rows;

    // Remap headers to standard names
    const mappings = profile.columnMappings[filename] ?? {};
    const { mappedHeaders, indexMap } = remapHeaders(headers, mappings);
    const mappedRows = filteredRows.map((r) => remapRow(r, indexMap));

    // Format output
    const content = formatOutput(mappedHeaders, mappedRows, options.format);
    const ext = getExtension(options.format);
    const baseName = path.basename(filename, ".tsv");

    exportedFiles.push({
      filename: `${baseName}${ext}`,
      content,
      rowCount: mappedRows.length,
    });
  }

  const metadata = generateMetadata(profile, exportedFiles);

  return {
    dataset: options.dataset,
    format: options.format,
    files: exportedFiles,
    metadata,
  };
}

// ============================================================================
// Versioned dataset releases (US-011)
//
// A "release" is a versioned, citable snapshot of the whole open corpus: all
// dataset profiles exported together, tagged with a semver version, a license,
// row counts, and (optionally) a minted DOI. The semver/metadata assembly is
// PURE (unit-tested with no fs/clock/network); `buildDatasetSnapshot` reuses
// `exportDataset` for the file contents and takes an injectable clock + DOI
// minter so the whole pipeline is testable without a live network / Zenodo token.
// ============================================================================

/** Default semver for the published dataset corpus (the seed / first release). */
export const DATASET_RELEASE_VERSION = "1.0.0";

/** Open license the whole corpus is released under. */
export const DATASET_LICENSE = "CC-BY-4.0";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parse a `major.minor.patch` string; returns null when malformed. */
export function parseSemver(version: string): SemVer | null {
  const m = SEMVER_RE.exec((version ?? "").trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Format a SemVer back to its `major.minor.patch` string. */
export function formatSemver(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export type VersionBumpLevel = "major" | "minor" | "patch";

/** Bump a semver string at the given level (resets lower components). Throws on a malformed input. */
export function bumpVersion(version: string, level: VersionBumpLevel): string {
  const v = parseSemver(version);
  if (!v) throw new Error(`Invalid semver: ${version}`);
  switch (level) {
    case "major":
      return formatSemver({ major: v.major + 1, minor: 0, patch: 0 });
    case "minor":
      return formatSemver({ major: v.major, minor: v.minor + 1, patch: 0 });
    case "patch":
      return formatSemver({ major: v.major, minor: v.minor, patch: v.patch + 1 });
  }
}

/** Change counts (mirrors the changelog `byChangeType` shape) used to derive a bump. */
export interface ChangeCounts {
  added: number;
  modified: number;
  removed: number;
}

/**
 * Map changelog change-type counts to a semver bump level: any removals ⇒ major
 * (potentially breaking), else any additions ⇒ minor (backward-compatible growth),
 * else modifications only (or no changes) ⇒ patch (a corrective re-release).
 */
export function determineVersionBump(counts: ChangeCounts): VersionBumpLevel {
  if (counts.removed > 0) return "major";
  if (counts.added > 0) return "minor";
  return "patch";
}

/** Next version derived from the previous version + changelog change counts. */
export function nextVersionFromChangelog(previousVersion: string, counts: ChangeCounts): string {
  return bumpVersion(previousVersion, determineVersionBump(counts));
}

export interface DoiMintResult {
  doi: string;
  doiUrl: string;
}

/** Injectable DOI minter (e.g. Zenodo). Returns null when minting is unavailable/disabled. */
export interface DoiMinter {
  mint(metadata: DatasetSnapshotMetadata): Promise<DoiMintResult | null>;
}

/** A minter that never mints — the safe default so releases work without a Zenodo token. */
export const nullDoiMinter: DoiMinter = {
  async mint() {
    return null;
  },
};

export interface ZenodoMinterOptions {
  /** Zenodo personal access token (default `process.env.ZENODO_TOKEN`). */
  token?: string;
  /** Use the sandbox instance (default from `process.env.ZENODO_SANDBOX === "true"`). */
  sandbox?: boolean;
  /** Injectable fetch for tests (default global `fetch`). */
  fetchImpl?: typeof fetch;
}

/**
 * Zenodo DOI minter. Reserves a DOI by creating a draft deposition and returns the
 * prereserved DOI. **Disabled (mint → null) when no token is configured**, so releases
 * work out-of-the-box without a Zenodo account (mirrors the GEONAMES_USERNAME pattern).
 * Network is behind the injectable `fetchImpl`, so it is unit-testable without a live call.
 */
export function createZenodoDoiMinter(options: ZenodoMinterOptions = {}): DoiMinter {
  const token = options.token ?? process.env.ZENODO_TOKEN;
  const sandbox = options.sandbox ?? process.env.ZENODO_SANDBOX === "true";
  const base = sandbox ? "https://sandbox.zenodo.org" : "https://zenodo.org";
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async mint(metadata) {
      if (!token) return null;
      const res = await doFetch(
        `${base}/api/deposit/depositions?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: {
              title: `${metadata.title} v${metadata.version}`,
              upload_type: "dataset",
              description: metadata.description,
              version: metadata.version,
              license: metadata.license.toLowerCase(),
            },
          }),
        }
      );
      if (!res.ok) {
        throw new Error(`Zenodo DOI minting failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        metadata?: { prereserve_doi?: { doi?: string } };
      };
      const doi = data.metadata?.prereserve_doi?.doi;
      if (!doi) return null;
      return { doi, doiUrl: `https://doi.org/${doi}` };
    },
  };
}

export interface DatasetSnapshotEntry {
  id: string;
  name: string;
  fileCount: number;
  totalRows: number;
}

export interface DatasetSnapshotMetadata {
  title: string;
  description: string;
  version: string;
  releaseDate: string;
  doi: string | null;
  doiUrl: string | null;
  license: string;
  source: string;
  format: ExportFormat;
  datasets: DatasetSnapshotEntry[];
  fileCount: number;
  totalRows: number;
}

export interface DatasetSnapshotFile {
  dataset: string;
  filename: string;
  content: string;
  rowCount: number;
}

export interface DatasetSnapshot {
  metadata: DatasetSnapshotMetadata;
  files: DatasetSnapshotFile[];
}

export interface AssembleSnapshotMetadataOptions {
  version: string;
  releaseDate: string;
  format: ExportFormat;
  license?: string;
  doi?: string | null;
  doiUrl?: string | null;
}

/** Assemble release metadata (version, DOI, license, per-dataset + total row counts) from exports. Pure. */
export function assembleSnapshotMetadata(
  exports: ExportResult[],
  opts: AssembleSnapshotMetadataOptions
): DatasetSnapshotMetadata {
  const datasets: DatasetSnapshotEntry[] = exports.map((e) => ({
    id: e.dataset,
    name: e.metadata.title.replace(/^LinguaScrape Export:\s*/, ""),
    fileCount: e.files.length,
    totalRows: e.files.reduce((sum, f) => sum + f.rowCount, 0),
  }));
  return {
    title: "LinguaScrape Open Dataset",
    description:
      "Versioned, citable snapshot of the LinguaScrape open linguistic + cultural corpus.",
    version: opts.version,
    releaseDate: opts.releaseDate,
    doi: opts.doi ?? null,
    doiUrl: opts.doiUrl ?? null,
    license: opts.license ?? DATASET_LICENSE,
    source: "LinguaScrape (https://github.com/linguascrape)",
    format: opts.format,
    datasets,
    fileCount: datasets.reduce((s, d) => s + d.fileCount, 0),
    totalRows: datasets.reduce((s, d) => s + d.totalRows, 0),
  };
}

export interface BuildDatasetSnapshotOptions {
  /** Export format for the bundled files (default `json`). */
  format?: ExportFormat;
  /** Subset of profile ids to include (default: all profiles). */
  datasets?: string[];
  /** Explicit version — overrides changelog-derived versioning. */
  version?: string;
  /** Previous release version; combined with `changeCounts` to derive the next version. */
  previousVersion?: string;
  /** Changelog change counts used to derive the semver bump from `previousVersion`. */
  changeCounts?: ChangeCounts;
  /** Injectable release timestamp (default now). */
  releaseDate?: string;
  license?: string;
  /** Injectable DOI minter; when it returns a DOI it is stamped onto the metadata. */
  doiMinter?: DoiMinter;
  filters?: Record<string, string>;
}

/**
 * Build a versioned dataset snapshot: export every (or a subset of) dataset
 * profile, assemble release metadata (semver version + license + row counts), and
 * optionally mint a DOI via the injected minter. Version precedence: explicit
 * `version` › `nextVersionFromChangelog(previousVersion, changeCounts)` ›
 * `DATASET_RELEASE_VERSION`.
 */
export async function buildDatasetSnapshot(
  options: BuildDatasetSnapshotOptions = {}
): Promise<DatasetSnapshot> {
  const format = options.format ?? "json";
  const profileIds =
    options.datasets && options.datasets.length > 0
      ? options.datasets
      : DATASET_PROFILES.map((p) => p.id);

  const exports: ExportResult[] = [];
  for (const id of profileIds) {
    exports.push(await exportDataset({ dataset: id, format, filters: options.filters }));
  }

  const version =
    options.version ??
    (options.previousVersion && options.changeCounts
      ? nextVersionFromChangelog(options.previousVersion, options.changeCounts)
      : DATASET_RELEASE_VERSION);

  const releaseDate = options.releaseDate ?? new Date().toISOString();

  let metadata = assembleSnapshotMetadata(exports, {
    version,
    releaseDate,
    format,
    license: options.license,
  });

  if (options.doiMinter) {
    const minted = await options.doiMinter.mint(metadata);
    if (minted) {
      metadata = { ...metadata, doi: minted.doi, doiUrl: minted.doiUrl };
    }
  }

  const files: DatasetSnapshotFile[] = exports.flatMap((e) =>
    e.files.map((f) => ({
      dataset: e.dataset,
      filename: f.filename,
      content: f.content,
      rowCount: f.rowCount,
    }))
  );

  return { metadata, files };
}

/** Validate export options, returning an array of error messages (empty = valid) */
export function validateExportOptions(options: ExportOptions): string[] {
  const errors: string[] = [];

  if (!options.dataset) {
    errors.push("Dataset is required");
  } else if (!getDatasetProfile(options.dataset)) {
    errors.push(
      `Unknown dataset: ${options.dataset}. Available: ${DATASET_PROFILES.map((p) => p.id).join(", ")}`
    );
  }

  const validFormats: ExportFormat[] = ["cldf", "csv", "tsv", "json"];
  if (!options.format) {
    errors.push("Format is required");
  } else if (!validFormats.includes(options.format)) {
    errors.push(
      `Invalid format: ${options.format}. Available: ${validFormats.join(", ")}`
    );
  }

  if (options.includeFiles) {
    const profile = getDatasetProfile(options.dataset);
    if (profile) {
      for (const f of options.includeFiles) {
        if (!profile.files.includes(f)) {
          errors.push(
            `File ${f} is not part of dataset ${options.dataset}. Available: ${profile.files.join(", ")}`
          );
        }
      }
    }
  }

  return errors;
}
