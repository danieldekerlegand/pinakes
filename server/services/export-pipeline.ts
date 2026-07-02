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
