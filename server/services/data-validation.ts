/**
 * Data Validation and Cross-Referencing Service
 *
 * Validates TSV data files for schema correctness, data quality,
 * and referential integrity across all domains.
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  file: string;
  row?: number;
  column?: string;
  severity: Severity;
  message: string;
  value?: string;
}

export interface FileValidationResult {
  file: string;
  rowCount: number;
  columns: string[];
  issues: ValidationIssue[];
}

export interface CrossReferenceResult {
  sourceFile: string;
  sourceColumn: string;
  targetFile: string;
  targetColumn: string;
  totalReferences: number;
  brokenReferences: number;
  issues: ValidationIssue[];
}

export interface ValidationReport {
  timestamp: string;
  filesValidated: number;
  totalRows: number;
  totalIssues: number;
  issuesBySeverity: Record<Severity, number>;
  fileResults: FileValidationResult[];
  crossReferences: CrossReferenceResult[];
}

interface ColumnRule {
  name: string;
  required?: boolean;
  type?: "string" | "number" | "json" | "json-array" | "coordinates" | "boolean";
  allowEmpty?: boolean;
}

interface FileSchema {
  file: string;
  columns: ColumnRule[];
}

interface CrossReference {
  sourceFile: string;
  sourceColumn: string;
  targetFile: string;
  targetColumn: string;
  isJsonArray?: boolean;
  /** If true, empty/missing values are allowed */
  optional?: boolean;
}

// ============================================================================
// TSV Parsing (standalone, no dependency on tsv-storage)
// ============================================================================

function parseTsvFile(filePath: string): { header: string[]; rows: string[][] } | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

function getCol(header: string[], name: string): number {
  return header.indexOf(name);
}

function getCellValue(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

// ============================================================================
// Schema Definitions
// ============================================================================

const FILE_SCHEMAS: FileSchema[] = [
  {
    file: "languages.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "family_id" },
      { name: "parent_language_id", allowEmpty: true },
      { name: "region" },
      { name: "status" },
      { name: "time_origin", type: "number", allowEmpty: true },
      { name: "time_end", type: "number", allowEmpty: true },
      { name: "latitude", type: "number", allowEmpty: true },
      { name: "longitude", type: "number", allowEmpty: true },
    ],
  },
  {
    file: "families.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "parent_id", allowEmpty: true },
      { name: "total_speakers", type: "number", allowEmpty: true },
      { name: "language_count", type: "number", allowEmpty: true },
    ],
  },
  {
    file: "civilizations.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "time_period_start", type: "number" },
      { name: "time_period_end", type: "number", allowEmpty: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
      { name: "haplogroup_ids", type: "json-array", allowEmpty: true },
      { name: "cuisine_id", allowEmpty: true },
    ],
  },
  {
    file: "archaeological-sites.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "coordinates", type: "json" },
      { name: "time_period_start", type: "number", allowEmpty: true },
      { name: "time_period_end", type: "number", allowEmpty: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
      { name: "associated_culture_ids", type: "json-array", allowEmpty: true },
      { name: "associated_civilization_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "archaeological-cultures.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "coordinates", type: "json", allowEmpty: true },
      { name: "time_period_start", type: "number", allowEmpty: true },
      { name: "time_period_end", type: "number", allowEmpty: true },
      { name: "predecessor_culture_ids", type: "json-array", allowEmpty: true },
      { name: "successor_culture_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "haplogroups.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "parent_id", allowEmpty: true },
      { name: "haplogroup_type" },
      { name: "associated_language_family_ids", type: "json-array", allowEmpty: true },
      { name: "associated_civilization_ids", type: "json-array", allowEmpty: true },
      { name: "time_origin", type: "number", allowEmpty: true },
    ],
  },
  {
    file: "religions.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "coordinates", type: "json", allowEmpty: true },
      { name: "time_origin", type: "number", allowEmpty: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "deities.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_religion_ids", type: "json-array", allowEmpty: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "myth-motifs.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_religion_ids", type: "json-array", allowEmpty: true },
      { name: "associated_deity_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "cuisines.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
      { name: "time_origin", type: "number", allowEmpty: true },
    ],
  },
  {
    file: "cuisine-items.tsv",
    columns: [
      { name: "id", required: true },
      { name: "cuisine_id", required: true },
    ],
  },
  {
    file: "cooking-techniques.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "cuisine_id", required: true },
    ],
  },
  {
    file: "ingredient-origins.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "cuisine_id", allowEmpty: true },
    ],
  },
  {
    file: "music-traditions.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
      { name: "time_origin", type: "number", allowEmpty: true },
    ],
  },
  {
    file: "musical-instruments.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_tradition_ids", type: "json-array", allowEmpty: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "dance-traditions.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
      { name: "associated_music_tradition_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "trade-routes.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "traded_goods", type: "json-array", allowEmpty: true },
      { name: "associated_languages", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "trade-goods.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "trade_routes", type: "json-array", allowEmpty: true },
      { name: "associated_languages", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "migration-routes.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_languages", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "sound-changes.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "family_id" },
      { name: "source_language_id" },
      { name: "target_language_id" },
    ],
  },
  {
    file: "language-contacts.tsv",
    columns: [
      { name: "id", required: true },
      { name: "source_language_id", required: true },
      { name: "target_language_id", required: true },
    ],
  },
  {
    file: "phonological-inventories.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_id", required: true },
      { name: "consonants", type: "json-array" },
      { name: "vowels", type: "json-array" },
    ],
  },
  {
    file: "grammar-features.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_id", required: true },
      { name: "word_order" },
    ],
  },
  {
    file: "writing-systems.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "parent_system_id", allowEmpty: true },
      { name: "language_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "verb-paradigms.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_id", required: true },
    ],
  },
  {
    file: "sample-texts.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_id", required: true },
    ],
  },
  {
    file: "urheimat-hypotheses.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_family_id", required: true },
    ],
  },
  {
    file: "literary-traditions.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_language_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "literary-works.tsv",
    columns: [
      { name: "id", required: true },
      { name: "title", required: true },
      { name: "tradition_id", allowEmpty: true },
      { name: "language_id", allowEmpty: true },
    ],
  },
  {
    file: "civilization-boundaries.tsv",
    columns: [
      { name: "id", required: true },
      { name: "civilization_id", required: true },
    ],
  },
  {
    file: "kinship-systems.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_ids", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "language-ranges.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_id", allowEmpty: true },
      { name: "family_id", allowEmpty: true },
    ],
  },
  {
    file: "language-range-polygons.tsv",
    columns: [
      { name: "id", required: true },
      { name: "language_id", allowEmpty: true },
      { name: "family_id", allowEmpty: true },
    ],
  },
  {
    file: "battles.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "coordinates", type: "json" },
    ],
  },
  {
    file: "material-culture.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_languages", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "art-traditions.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_civilizations", type: "json-array", allowEmpty: true },
      { name: "associated_languages", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "architectural-styles.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_civilizations", type: "json-array", allowEmpty: true },
      { name: "associated_languages", type: "json-array", allowEmpty: true },
    ],
  },
  {
    file: "foodway-events.tsv",
    columns: [
      { name: "id", required: true },
      { name: "name", required: true },
      { name: "associated_route_id", allowEmpty: true },
    ],
  },
];

// ============================================================================
// Cross-Reference Definitions
// ============================================================================

const CROSS_REFERENCES: CrossReference[] = [
  // Language family references
  { sourceFile: "languages.tsv", sourceColumn: "family_id", targetFile: "families.tsv", targetColumn: "id", optional: true },
  { sourceFile: "languages.tsv", sourceColumn: "parent_language_id", targetFile: "languages.tsv", targetColumn: "id", optional: true },
  { sourceFile: "families.tsv", sourceColumn: "parent_id", targetFile: "families.tsv", targetColumn: "id", optional: true },

  // Civilization references
  { sourceFile: "civilizations.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "civilizations.tsv", sourceColumn: "haplogroup_ids", targetFile: "haplogroups.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "civilizations.tsv", sourceColumn: "cuisine_id", targetFile: "cuisines.tsv", targetColumn: "id", optional: true },
  { sourceFile: "civilization-boundaries.tsv", sourceColumn: "civilization_id", targetFile: "civilizations.tsv", targetColumn: "id" },

  // Archaeological references
  { sourceFile: "archaeological-sites.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "archaeological-sites.tsv", sourceColumn: "associated_culture_ids", targetFile: "archaeological-cultures.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "archaeological-sites.tsv", sourceColumn: "associated_civilization_ids", targetFile: "civilizations.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "archaeological-cultures.tsv", sourceColumn: "predecessor_culture_ids", targetFile: "archaeological-cultures.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "archaeological-cultures.tsv", sourceColumn: "successor_culture_ids", targetFile: "archaeological-cultures.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Haplogroup references
  { sourceFile: "haplogroups.tsv", sourceColumn: "parent_id", targetFile: "haplogroups.tsv", targetColumn: "id", optional: true },
  { sourceFile: "haplogroups.tsv", sourceColumn: "associated_language_family_ids", targetFile: "families.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "haplogroups.tsv", sourceColumn: "associated_civilization_ids", targetFile: "civilizations.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Religion / mythology references
  { sourceFile: "religions.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "deities.tsv", sourceColumn: "associated_religion_ids", targetFile: "religions.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "deities.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "myth-motifs.tsv", sourceColumn: "associated_religion_ids", targetFile: "religions.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "myth-motifs.tsv", sourceColumn: "associated_deity_ids", targetFile: "deities.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Cuisine references
  { sourceFile: "cuisines.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "cuisine-items.tsv", sourceColumn: "cuisine_id", targetFile: "cuisines.tsv", targetColumn: "id" },
  { sourceFile: "cooking-techniques.tsv", sourceColumn: "cuisine_id", targetFile: "cuisines.tsv", targetColumn: "id" },
  { sourceFile: "ingredient-origins.tsv", sourceColumn: "cuisine_id", targetFile: "cuisines.tsv", targetColumn: "id", optional: true },

  // Music references
  { sourceFile: "music-traditions.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "musical-instruments.tsv", sourceColumn: "associated_tradition_ids", targetFile: "music-traditions.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "musical-instruments.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "dance-traditions.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "dance-traditions.tsv", sourceColumn: "associated_music_tradition_ids", targetFile: "music-traditions.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Trade references
  { sourceFile: "trade-routes.tsv", sourceColumn: "traded_goods", targetFile: "trade-goods.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "trade-routes.tsv", sourceColumn: "associated_languages", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "trade-goods.tsv", sourceColumn: "trade_routes", targetFile: "trade-routes.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "trade-goods.tsv", sourceColumn: "associated_languages", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "migration-routes.tsv", sourceColumn: "associated_languages", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "foodway-events.tsv", sourceColumn: "associated_route_id", targetFile: "trade-routes.tsv", targetColumn: "id", optional: true },

  // Linguistic feature references
  { sourceFile: "sound-changes.tsv", sourceColumn: "family_id", targetFile: "families.tsv", targetColumn: "id" },
  { sourceFile: "sound-changes.tsv", sourceColumn: "source_language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "sound-changes.tsv", sourceColumn: "target_language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "language-contacts.tsv", sourceColumn: "source_language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "language-contacts.tsv", sourceColumn: "target_language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "phonological-inventories.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "grammar-features.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "verb-paradigms.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id" },
  { sourceFile: "sample-texts.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id" },

  // Writing system references
  { sourceFile: "writing-systems.tsv", sourceColumn: "parent_system_id", targetFile: "writing-systems.tsv", targetColumn: "id", optional: true },
  { sourceFile: "writing-systems.tsv", sourceColumn: "language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Urheimat references
  { sourceFile: "urheimat-hypotheses.tsv", sourceColumn: "language_family_id", targetFile: "families.tsv", targetColumn: "id" },

  // Literary references
  { sourceFile: "literary-traditions.tsv", sourceColumn: "associated_language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "literary-works.tsv", sourceColumn: "tradition_id", targetFile: "literary-traditions.tsv", targetColumn: "id", optional: true },
  { sourceFile: "literary-works.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id", optional: true },

  // Geographic references
  { sourceFile: "language-ranges.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id", optional: true },
  { sourceFile: "language-ranges.tsv", sourceColumn: "family_id", targetFile: "families.tsv", targetColumn: "id", optional: true },
  { sourceFile: "language-range-polygons.tsv", sourceColumn: "language_id", targetFile: "languages.tsv", targetColumn: "id", optional: true },
  { sourceFile: "language-range-polygons.tsv", sourceColumn: "family_id", targetFile: "families.tsv", targetColumn: "id", optional: true },

  // Material culture references
  { sourceFile: "material-culture.tsv", sourceColumn: "associated_languages", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Art/architecture references
  { sourceFile: "art-traditions.tsv", sourceColumn: "associated_civilizations", targetFile: "civilizations.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "art-traditions.tsv", sourceColumn: "associated_languages", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "architectural-styles.tsv", sourceColumn: "associated_civilizations", targetFile: "civilizations.tsv", targetColumn: "id", isJsonArray: true, optional: true },
  { sourceFile: "architectural-styles.tsv", sourceColumn: "associated_languages", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },

  // Kinship references
  { sourceFile: "kinship-systems.tsv", sourceColumn: "language_ids", targetFile: "languages.tsv", targetColumn: "id", isJsonArray: true, optional: true },
];

// ============================================================================
// Validation Service
// ============================================================================

export class DataValidationService {
  private lexiconsDir: string;
  private idCache: Map<string, Set<string>> = new Map();

  constructor(lexiconsDir: string) {
    this.lexiconsDir = lexiconsDir;
  }

  /**
   * Run full validation: schema checks + cross-reference integrity.
   */
  async validate(options?: {
    files?: string[];
    skipCrossReferences?: boolean;
  }): Promise<ValidationReport> {
    this.idCache.clear();

    const schemas = options?.files
      ? FILE_SCHEMAS.filter((s) => options.files!.includes(s.file))
      : FILE_SCHEMAS;

    const fileResults: FileValidationResult[] = [];
    let totalRows = 0;

    for (const schema of schemas) {
      const result = this.validateFile(schema);
      if (result) {
        fileResults.push(result);
        totalRows += result.rowCount;
      }
    }

    let crossReferences: CrossReferenceResult[] = [];
    if (!options?.skipCrossReferences) {
      const refs = options?.files
        ? CROSS_REFERENCES.filter(
            (r) =>
              options.files!.includes(r.sourceFile) ||
              options.files!.includes(r.targetFile)
          )
        : CROSS_REFERENCES;
      crossReferences = this.validateCrossReferences(refs);
    }

    const allIssues = [
      ...fileResults.flatMap((r) => r.issues),
      ...crossReferences.flatMap((r) => r.issues),
    ];

    const issuesBySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of allIssues) {
      issuesBySeverity[issue.severity]++;
    }

    return {
      timestamp: new Date().toISOString(),
      filesValidated: fileResults.length,
      totalRows,
      totalIssues: allIssues.length,
      issuesBySeverity,
      fileResults,
      crossReferences,
    };
  }

  /**
   * Validate a single file against its schema.
   */
  private validateFile(schema: FileSchema): FileValidationResult | null {
    const filePath = path.join(this.lexiconsDir, schema.file);
    const parsed = parseTsvFile(filePath);

    if (!parsed) {
      return {
        file: schema.file,
        rowCount: 0,
        columns: [],
        issues: [{ file: schema.file, severity: "error", message: `File not found: ${schema.file}` }],
      };
    }

    const { header, rows } = parsed;
    const issues: ValidationIssue[] = [];

    // Check required columns exist
    for (const col of schema.columns) {
      if (getCol(header, col.name) < 0) {
        issues.push({
          file: schema.file,
          column: col.name,
          severity: col.required ? "error" : "warning",
          message: `Missing column '${col.name}'`,
        });
      }
    }

    // Collect IDs for cross-reference lookups
    const idIdx = getCol(header, "id");
    if (idIdx >= 0) {
      const ids = new Set<string>();
      for (const row of rows) {
        const id = getCellValue(row, idIdx);
        if (id) ids.add(id);
      }
      this.idCache.set(schema.file, ids);
    }

    // Validate each row
    const seenIds = new Set<string>();
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowNum = r + 2; // 1-indexed + header

      for (const col of schema.columns) {
        const idx = getCol(header, col.name);
        if (idx < 0) continue;

        const val = getCellValue(row, idx);

        // Required check
        if (col.required && !val) {
          issues.push({
            file: schema.file,
            row: rowNum,
            column: col.name,
            severity: "error",
            message: `Required field '${col.name}' is empty`,
          });
          continue;
        }

        if (!val && col.allowEmpty) continue;
        if (!val) continue;

        // ID uniqueness
        if (col.name === "id") {
          if (seenIds.has(val)) {
            issues.push({
              file: schema.file,
              row: rowNum,
              column: "id",
              severity: "error",
              message: `Duplicate ID '${val}'`,
              value: val,
            });
          }
          seenIds.add(val);
        }

        // Type checks
        if (col.type === "number" && val && val !== "null") {
          const num = Number(val);
          if (isNaN(num)) {
            issues.push({
              file: schema.file,
              row: rowNum,
              column: col.name,
              severity: "error",
              message: `Invalid number value`,
              value: val,
            });
          }
        }

        if ((col.type === "json" || col.type === "json-array") && val && val !== "null") {
          try {
            const parsed = JSON.parse(val);
            if (col.type === "json-array" && !Array.isArray(parsed)) {
              issues.push({
                file: schema.file,
                row: rowNum,
                column: col.name,
                severity: "warning",
                message: `Expected JSON array but got ${typeof parsed}`,
                value: val.slice(0, 100),
              });
            }
          } catch {
            issues.push({
              file: schema.file,
              row: rowNum,
              column: col.name,
              severity: "error",
              message: `Invalid JSON`,
              value: val.slice(0, 100),
            });
          }
        }
      }

      // Time period consistency check
      const startIdx = getCol(header, "time_period_start");
      const endIdx = getCol(header, "time_period_end");
      if (startIdx >= 0 && endIdx >= 0) {
        const startVal = getCellValue(row, startIdx);
        const endVal = getCellValue(row, endIdx);
        if (startVal && endVal && endVal !== "null") {
          const start = Number(startVal);
          const end = Number(endVal);
          if (!isNaN(start) && !isNaN(end) && end < start) {
            issues.push({
              file: schema.file,
              row: rowNum,
              column: "time_period_end",
              severity: "warning",
              message: `End date (${end}) before start date (${start})`,
            });
          }
        }
      }

      // Also check time_origin / time_end pair
      const originIdx = getCol(header, "time_origin");
      const timeEndIdx = getCol(header, "time_end");
      if (originIdx >= 0 && timeEndIdx >= 0) {
        const originVal = getCellValue(row, originIdx);
        const endVal = getCellValue(row, timeEndIdx);
        if (originVal && endVal && endVal !== "null") {
          const origin = Number(originVal);
          const end = Number(endVal);
          if (!isNaN(origin) && !isNaN(end) && end < origin) {
            issues.push({
              file: schema.file,
              row: rowNum,
              column: "time_end",
              severity: "warning",
              message: `End date (${end}) before origin date (${origin})`,
            });
          }
        }
      }
    }

    return {
      file: schema.file,
      rowCount: rows.length,
      columns: header,
      issues,
    };
  }

  /**
   * Load the set of IDs for a given file (cached).
   */
  private getIdSet(file: string, column: string = "id"): Set<string> {
    const cacheKey = `${file}:${column}`;
    if (this.idCache.has(cacheKey)) return this.idCache.get(cacheKey)!;
    if (column === "id" && this.idCache.has(file)) return this.idCache.get(file)!;

    const filePath = path.join(this.lexiconsDir, file);
    const parsed = parseTsvFile(filePath);
    if (!parsed) return new Set();

    const idx = getCol(parsed.header, column);
    if (idx < 0) return new Set();

    const ids = new Set<string>();
    for (const row of parsed.rows) {
      const val = getCellValue(row, idx);
      if (val) ids.add(val);
    }

    this.idCache.set(cacheKey, ids);
    if (column === "id") this.idCache.set(file, ids);
    return ids;
  }

  /**
   * Validate all cross-references between files.
   */
  private validateCrossReferences(refs: CrossReference[]): CrossReferenceResult[] {
    const results: CrossReferenceResult[] = [];

    for (const ref of refs) {
      const sourceFilePath = path.join(this.lexiconsDir, ref.sourceFile);
      const sourceParsed = parseTsvFile(sourceFilePath);
      if (!sourceParsed) continue;

      const targetIds = this.getIdSet(ref.targetFile, ref.targetColumn);
      if (targetIds.size === 0) continue; // target file missing or empty

      const sourceColIdx = getCol(sourceParsed.header, ref.sourceColumn);
      if (sourceColIdx < 0) continue;

      const issues: ValidationIssue[] = [];
      let totalRefs = 0;
      let brokenRefs = 0;

      for (let r = 0; r < sourceParsed.rows.length; r++) {
        const row = sourceParsed.rows[r];
        const rowNum = r + 2;
        const rawVal = getCellValue(row, sourceColIdx);

        if (!rawVal || rawVal === "null") continue;

        let refIds: string[];

        if (ref.isJsonArray) {
          try {
            const parsed = JSON.parse(rawVal);
            if (Array.isArray(parsed)) {
              refIds = parsed.map((v: unknown) => String(v).trim()).filter(Boolean);
            } else {
              continue; // not a valid array, schema validation catches this
            }
          } catch {
            continue; // invalid JSON, schema validation catches this
          }
        } else {
          refIds = [rawVal];
        }

        for (const refId of refIds) {
          totalRefs++;
          if (!targetIds.has(refId)) {
            brokenRefs++;
            issues.push({
              file: ref.sourceFile,
              row: rowNum,
              column: ref.sourceColumn,
              severity: ref.optional ? "warning" : "error",
              message: `Reference '${refId}' not found in ${ref.targetFile}.${ref.targetColumn}`,
              value: refId,
            });
          }
        }
      }

      if (totalRefs > 0 || issues.length > 0) {
        results.push({
          sourceFile: ref.sourceFile,
          sourceColumn: ref.sourceColumn,
          targetFile: ref.targetFile,
          targetColumn: ref.targetColumn,
          totalReferences: totalRefs,
          brokenReferences: brokenRefs,
          issues,
        });
      }
    }

    return results;
  }

  /**
   * Get a summary of all available data files.
   */
  getDataSummary(): Array<{ file: string; exists: boolean; rowCount: number; columnCount: number }> {
    return FILE_SCHEMAS.map((schema) => {
      const filePath = path.join(this.lexiconsDir, schema.file);
      const parsed = parseTsvFile(filePath);
      return {
        file: schema.file,
        exists: parsed !== null,
        rowCount: parsed?.rows.length ?? 0,
        columnCount: parsed?.header.length ?? 0,
      };
    });
  }

  /**
   * Get all defined cross-reference rules (useful for UI display).
   */
  getCrossReferenceRules(): CrossReference[] {
    return CROSS_REFERENCES;
  }
}
