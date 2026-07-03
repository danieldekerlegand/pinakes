/**
 * Runtime analytical index over the TSV corpus (US-001, tasklist 13 platform-infra).
 *
 * LinguaScrape keeps `lexicons/*.tsv` as the single source of truth (see
 * server/tsv-storage.ts). This module builds a **read-only, in-memory DuckDB**
 * mirror of those TSVs so heavy *tabular* work — facet counts, GROUP BY
 * aggregates, ad-hoc analytical SQL — runs in one indexed pass instead of
 * re-parsing files and looping in JS on every request.
 *
 * Division of labour (docs/culturescrape-integration.md):
 *   - **tabular / aggregate** queries  → this DuckDB index
 *   - **graph / correlation** queries  → Neo4j (server/services/graph-store.ts)
 *   - **CPU-domain** compute (distance, etymology) → stays in TS
 *
 * The index is *derived*: it never writes back to the TSVs and is not on the TSV
 * write path. It is rebuilt incrementally from file mtimes ({@link AnalyticalIndex.refresh}),
 * so an edited/added/removed `*.tsv` re-syncs a single table without a full reload.
 *
 * DuckDB reads each TSV byte-faithfully — matching server/tsv-storage.ts's
 * `parseTsv` (a plain `split("\t")`): quoting/escaping are disabled and empty
 * cells stay as `""` (not NULL) via a nullstr sentinel. Every column is VARCHAR,
 * so index cells compare equal to the raw string cells the in-memory loaders use.
 */
import fs from "node:fs";
import path from "node:path";

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

/** A `read_csv` nullstr that cannot occur in real data, so empty cells stay `""`. */
const NULL_SENTINEL = "__LINGUASCRAPE_NEVER_NULL_SENTINEL__";

/** One row of a facet-count result: a distinct value and how many rows carry it. */
export interface FacetCount {
  /** the distinct cell value (empty string for blank cells; never null). */
  value: string;
  /** number of rows in the table with this value in the faceted column. */
  count: number;
}

/** Metadata for one indexed table (one TSV file). */
export interface IndexedTable {
  /** sanitized SQL table name, e.g. `language_ranges`. */
  table: string;
  /** source file base name, e.g. `language-ranges.tsv`. */
  file: string;
  /** column names, in header order. */
  columns: string[];
  /** number of data rows. */
  rowCount: number;
}

interface TrackedTable {
  file: string;
  absPath: string;
  mtimeMs: number;
  size: number;
  columns: string[];
}

/** Result of an incremental {@link AnalyticalIndex.refresh}. */
export interface RefreshResult {
  /** tables (re)built because their file was new or changed. */
  rebuilt: string[];
  /** tables dropped because their source file was removed. */
  dropped: string[];
}

/**
 * Turn a lexicon file base name into a safe SQL table identifier:
 * `language-ranges.tsv` → `language_ranges`. Non-alphanumerics collapse to `_`;
 * a leading digit is prefixed with `t_` so the result is always a valid
 * identifier. Table names are the only identifiers built from filenames, so this
 * is the sole place filenames touch SQL.
 */
export function tableNameForFile(fileBase: string): string {
  const stem = fileBase.replace(/\.tsv$/i, "").toLowerCase();
  let name = stem.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (name === "") name = "table";
  if (/^[0-9]/.test(name)) name = `t_${name}`;
  return name;
}

function assertIdentifier(name: string, kind: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${kind} identifier: ${JSON.stringify(name)}`);
  }
}

/** SQL string literal with single quotes doubled. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * In-memory DuckDB index over a directory of TSV files. Construct with
 * {@link AnalyticalIndex.create}; it builds every `*.tsv` in the directory into
 * a table. The instance is a lazy singleton in production
 * ({@link getAnalyticalIndex}) but is freely constructable in tests against a
 * fixture directory.
 */
export class AnalyticalIndex {
  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;
  private readonly lexiconsDir: string;
  private readonly tracked = new Map<string, TrackedTable>();

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection, lexiconsDir: string) {
    this.instance = instance;
    this.connection = connection;
    this.lexiconsDir = lexiconsDir;
  }

  /** Build an index over every `*.tsv` in `lexiconsDir`. */
  static async create(lexiconsDir: string): Promise<AnalyticalIndex> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    const index = new AnalyticalIndex(instance, connection, lexiconsDir);
    await index.refresh();
    return index;
  }

  /**
   * Re-sync the index with the TSV directory using file mtime + size:
   * new or changed files are (re)built, and tables whose file has disappeared
   * are dropped. Returns which tables changed. Cheap enough to call on demand;
   * a no-change refresh touches DuckDB for nothing removed/added.
   */
  async refresh(): Promise<RefreshResult> {
    const rebuilt: string[] = [];
    const dropped: string[] = [];

    const files = fs.existsSync(this.lexiconsDir)
      ? fs.readdirSync(this.lexiconsDir).filter((f) => f.toLowerCase().endsWith(".tsv"))
      : [];
    const seen = new Set<string>();

    for (const file of files) {
      const table = tableNameForFile(file);
      seen.add(table);
      const absPath = path.join(this.lexiconsDir, file);
      const stat = fs.statSync(absPath);
      const prior = this.tracked.get(table);
      if (prior && prior.mtimeMs === stat.mtimeMs && prior.size === stat.size) {
        continue; // unchanged
      }
      const columns = await this.buildTable(table, absPath);
      this.tracked.set(table, {
        file,
        absPath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        columns,
      });
      rebuilt.push(table);
    }

    for (const table of Array.from(this.tracked.keys())) {
      if (!seen.has(table)) {
        assertIdentifier(table, "table");
        await this.connection.run(`DROP TABLE IF EXISTS "${table}"`);
        this.tracked.delete(table);
        dropped.push(table);
      }
    }

    return { rebuilt, dropped };
  }

  private async buildTable(table: string, absPath: string): Promise<string[]> {
    assertIdentifier(table, "table");
    // Byte-faithful TSV read (see module header): tab delimiter, header row,
    // all columns VARCHAR, quoting/escaping disabled, empty cells kept as "".
    const readCsv =
      `read_csv(${sqlString(absPath)}, delim='\t', header=true, ` +
      `all_varchar=true, quote='', escape='', nullstr=${sqlString(NULL_SENTINEL)}, ` +
      `sample_size=-1, ignore_errors=false)`;
    await this.connection.run(`CREATE OR REPLACE TABLE "${table}" AS SELECT * FROM ${readCsv}`);
    const reader = await this.connection.runAndReadAll(`SELECT * FROM "${table}" LIMIT 0`);
    return reader.columnNames();
  }

  /** Names of all indexed tables. */
  tables(): string[] {
    return Array.from(this.tracked.keys()).sort();
  }

  /** Whether a table exists in the index. */
  hasTable(table: string): boolean {
    return this.tracked.has(table);
  }

  private requireTable(table: string): TrackedTable {
    const tracked = this.tracked.get(table);
    if (!tracked) throw new Error(`No indexed table: ${table}`);
    return tracked;
  }

  /** Column names of an indexed table, in header order. */
  columns(table: string): string[] {
    return [...this.requireTable(table).columns];
  }

  /** Metadata for every indexed table. */
  async describe(): Promise<IndexedTable[]> {
    const out: IndexedTable[] = [];
    for (const table of this.tables()) {
      const tracked = this.requireTable(table);
      out.push({
        table,
        file: tracked.file,
        columns: [...tracked.columns],
        rowCount: await this.count(table),
      });
    }
    return out;
  }

  /** Row count of a table. */
  async count(table: string): Promise<number> {
    this.requireTable(table);
    assertIdentifier(table, "table");
    const reader = await this.connection.runAndReadAll(
      `SELECT CAST(COUNT(*) AS BIGINT) AS n FROM "${table}"`,
    );
    const rows = reader.getRowObjectsJson() as Array<{ n: string }>;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Facet counts for one column: the distinct values of `column` and how many
   * rows carry each, ordered by count desc then value asc (deterministic). This
   * is the aggregate the faceted-search work (US-005) routes through the index.
   */
  async facetCounts(table: string, column: string): Promise<FacetCount[]> {
    const tracked = this.requireTable(table);
    if (!tracked.columns.includes(column)) {
      throw new Error(`No column ${JSON.stringify(column)} in table ${table}`);
    }
    assertIdentifier(table, "table");
    const reader = await this.connection.runAndReadAll(
      `SELECT "${column}" AS value, CAST(COUNT(*) AS BIGINT) AS n ` +
        `FROM "${table}" GROUP BY "${column}" ORDER BY COUNT(*) DESC, "${column}" ASC`,
    );
    const rows = reader.getRowObjectsJson() as Array<{ value: string | null; n: string }>;
    return rows.map((r) => ({ value: r.value ?? "", count: Number(r.n) }));
  }

  /**
   * Run read-only analytical SQL against the index and return JSON-safe row
   * objects (all cell values are strings/nulls — BigInt counts are stringified).
   * Optional positional `$1, $2, …` parameters are bound as VARCHAR. Intended for
   * SELECT/aggregate queries; the index is derived, so callers must not mutate it.
   */
  async query(sql: string, params: string[] = []): Promise<Array<Record<string, unknown>>> {
    if (params.length === 0) {
      const reader = await this.connection.runAndReadAll(sql);
      return reader.getRowObjectsJson() as Array<Record<string, unknown>>;
    }
    const prepared = await this.connection.prepare(sql);
    params.forEach((value, i) => prepared.bindVarchar(i + 1, value));
    const reader = await prepared.runAndReadAll();
    return reader.getRowObjectsJson() as Array<Record<string, unknown>>;
  }

  /** Release the DuckDB connection and instance. Safe to call more than once. */
  close(): void {
    this.connection.disconnectSync();
    this.instance.closeSync();
    this.tracked.clear();
  }
}

// ── Lazy singleton (production wiring) ───────────────────────────────────────

let singleton: AnalyticalIndex | null = null;
let building: Promise<AnalyticalIndex> | null = null;

/** Absolute path to the live `lexicons/` directory. */
function defaultLexiconsDir(): string {
  return process.env.LEXICONS_DIR
    ? path.resolve(process.env.LEXICONS_DIR)
    : path.resolve(process.cwd(), "lexicons");
}

/**
 * Get the process-wide analytical index, building it on first use. Concurrent
 * first-callers share one build. Prefer this in routes/services over
 * constructing a new index per request.
 */
export async function getAnalyticalIndex(): Promise<AnalyticalIndex> {
  if (singleton) return singleton;
  if (!building) {
    building = AnalyticalIndex.create(defaultLexiconsDir()).then((index) => {
      singleton = index;
      building = null;
      return index;
    });
  }
  return building;
}

/** Close and clear the singleton (server shutdown / test teardown). */
export async function closeAnalyticalIndex(): Promise<void> {
  if (building) {
    try {
      await building;
    } catch {
      /* build failed; nothing to close */
    }
  }
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
