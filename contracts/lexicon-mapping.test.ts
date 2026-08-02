import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEXICON_MAPPING,
  assertValidLexiconMapping,
  lexiconMappingByFile,
  mappedFiles,
  nodeFiles,
  edgeFiles,
} from "./lexicon-mapping.ts";
import { CANONICAL_DELIMITER } from "./canonical-schema.ts";

const LEXICONS_DIR = resolve(process.cwd(), "lexicons");

/** Every `*.tsv` currently in lexicons/. */
function lexiconFilesOnDisk(): string[] {
  return readdirSync(LEXICONS_DIR)
    .filter((f) => f.endsWith(".tsv"))
    .sort();
}

/** Unique header column names of a lexicon file (source headers can duplicate). */
function headerColumns(file: string): Set<string> {
  const text = readFileSync(resolve(LEXICONS_DIR, file), "utf8");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return new Set(firstLine.split(CANONICAL_DELIMITER));
}

describe("lexicon → canonical mapping (US-002)", () => {
  it("is well-formed against the canonical schema", () => {
    expect(() => assertValidLexiconMapping()).not.toThrow();
  });

  it("is total: every lexicons/*.tsv is mapped and nothing extra", () => {
    const onDisk = new Set(lexiconFilesOnDisk());
    const mapped = new Set(mappedFiles());
    // Files present on disk but missing from the mapping.
    expect([...onDisk].filter((f) => !mapped.has(f))).toEqual([]);
    // Mapping entries with no file on disk (renamed/deleted lexicon).
    expect([...mapped].filter((f) => !onDisk.has(f))).toEqual([]);
    expect(onDisk.size).toBe(57);
  });

  it("references only real column names, and every column is accounted for", () => {
    for (const file of lexiconFilesOnDisk()) {
      const mapping = lexiconMappingByFile(file);
      expect(mapping, `${file} has a mapping`).toBeDefined();
      const header = headerColumns(file);
      const mappedCols = new Set(mapping!.columns.map((c) => c.column));
      // No mapping entry may reference a column absent from the header.
      expect(
        [...mappedCols].filter((c) => !header.has(c)),
        `${file}: mapping references non-existent columns`,
      ).toEqual([]);
      // Every real column must be accounted for by the mapping.
      expect(
        [...header].filter((c) => !mappedCols.has(c)),
        `${file}: header columns missing from the mapping`,
      ).toEqual([]);
    }
  });

  it("maps the required edge-bearing files and columns", () => {
    // cultural-lineages: source_id/target_id/relationship_type -> edge structure.
    const lineages = lexiconMappingByFile("cultural-lineages.tsv")!;
    expect(lineages.kind).toBe("edge");
    const lineageTargets = Object.fromEntries(
      lineages.columns.filter((c) => c.target).map((c) => [c.column, c.target]),
    );
    expect(lineageTargets.source_id).toBe(":START_ID");
    expect(lineageTargets.target_id).toBe(":END_ID");
    expect(lineageTargets.relationship_type).toBe(":TYPE");

    // families.parent_id -> descended-from edge.
    const families = lexiconMappingByFile("families.tsv")!;
    expect(families.columns.find((c) => c.column === "parent_id")?.edge).toBe(
      "descended-from",
    );

    // languages.family_id / parent_language_id -> descended-from edges.
    const languages = lexiconMappingByFile("languages.tsv")!;
    expect(languages.columns.find((c) => c.column === "family_id")?.edge).toBe(
      "descended-from",
    );
    expect(
      languages.columns.find((c) => c.column === "parent_language_id")?.edge,
    ).toBe("descended-from");

    // archaeological-cultures predecessor/successor -> descended-from/absorbed-into.
    const arch = lexiconMappingByFile("archaeological-cultures.tsv")!;
    expect(
      arch.columns.find((c) => c.column === "predecessor_culture_ids")?.edge,
    ).toBe("descended-from");
    expect(
      arch.columns.find((c) => c.column === "successor_culture_ids")?.edge,
    ).toBe("absorbed-into");
  });

  it("classifies every file and covers all canonical node types with a mapped source", () => {
    // Sanity: node files declare a node type; edge files exist.
    for (const { file, node } of nodeFiles()) {
      expect(node, `${file} node type`).toBeTruthy();
    }
    expect(edgeFiles().length).toBeGreaterThan(0);

    // Kinds partition the file set.
    const total = LEXICON_MAPPING.files.length;
    const counted =
      LEXICON_MAPPING.files.filter((f) => f.kind === "node").length +
      LEXICON_MAPPING.files.filter((f) => f.kind === "edge").length +
      LEXICON_MAPPING.files.filter((f) => f.kind === "attribute").length +
      LEXICON_MAPPING.files.filter((f) => f.kind === "excluded").length;
    expect(counted).toBe(total);
  });

  it("documents every dropped column with a reason", () => {
    for (const f of LEXICON_MAPPING.files) {
      for (const c of f.columns) {
        if (c.drop === true) {
          expect(c.reason, `${f.file}.${c.column} drop reason`).toBeTruthy();
        }
      }
    }
  });
});
