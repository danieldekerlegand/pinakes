import fs from "node:fs";
import path from "node:path";

const LEXICONS_DIR = path.resolve("lexicons");

export interface ImportResult {
  target: string;
  rowsImported: number;
  rowsSkipped: number;
  errors: string[];
  backupPath?: string;
}

export interface ImportOptions {
  /** Target TSV file name (e.g. "languages.tsv") */
  target: string;
  /** Raw file content (CSV or TSV) */
  content: string;
  /** "append" adds rows; "replace" overwrites data rows (keeps matched headers) */
  mode: "append" | "replace";
  /** Skip rows with duplicate IDs already in the file (append mode only) */
  skipDuplicates?: boolean;
}

/** Detect delimiter: tab for TSV, comma for CSV */
export function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs >= commas ? "\t" : ",";
}

/** Parse CSV/TSV content into header + rows */
export function parseDelimited(
  content: string,
  delimiter: string
): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(delimiter));
  return { headers, rows };
}

/** Get list of importable TSV targets with their headers */
export async function getImportTargets(): Promise<
  Array<{ file: string; headers: string[] }>
> {
  const files = await fs.promises.readdir(LEXICONS_DIR);
  const targets: Array<{ file: string; headers: string[] }> = [];

  for (const file of files.filter((f) => f.endsWith(".tsv"))) {
    const filePath = path.join(LEXICONS_DIR, file);
    const content = await fs.promises.readFile(filePath, "utf8");
    const firstLine = content.split(/\r?\n/)[0] ?? "";
    const headers = firstLine.split("\t").map((h) => h.trim());
    targets.push({ file, headers });
  }

  return targets.sort((a, b) => a.file.localeCompare(b.file));
}

/** Map incoming headers to target headers, returning column index mapping */
function mapHeaders(
  incomingHeaders: string[],
  targetHeaders: string[]
): { mapping: Map<number, number>; unmapped: string[] } {
  const mapping = new Map<number, number>();
  const unmapped: string[] = [];

  const normalizedTarget = targetHeaders.map((h) => h.toLowerCase().trim());

  for (let i = 0; i < incomingHeaders.length; i++) {
    const normalized = incomingHeaders[i].toLowerCase().trim();
    const targetIdx = normalizedTarget.indexOf(normalized);
    if (targetIdx !== -1) {
      mapping.set(i, targetIdx);
    } else {
      unmapped.push(incomingHeaders[i]);
    }
  }

  return { mapping, unmapped };
}

/** Remap a row from incoming column order to target column order */
function remapRow(
  row: string[],
  mapping: Map<number, number>,
  targetColumnCount: number
): string[] {
  const output = new Array(targetColumnCount).fill("");
  for (const [srcIdx, dstIdx] of mapping) {
    output[dstIdx] = row[srcIdx]?.trim() ?? "";
  }
  return output;
}

/** Read existing IDs from first column of a TSV file */
async function readExistingIds(filePath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!fs.existsSync(filePath)) return ids;

  const content = await fs.promises.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  // Skip header, read first column
  for (let i = 1; i < lines.length; i++) {
    const firstCol = lines[i].split("\t")[0]?.trim();
    if (firstCol) ids.add(firstCol);
  }
  return ids;
}

/** Create a timestamped backup of a file */
async function createBackup(filePath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const backupDir = path.join(dir, ".backups");
  await fs.promises.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${base}_${timestamp}${ext}`);
  await fs.promises.copyFile(filePath, backupPath);
  return backupPath;
}

/** Perform bulk import of CSV/TSV data into a lexicons TSV file */
export async function bulkImport(options: ImportOptions): Promise<ImportResult> {
  const { target, content, mode, skipDuplicates = true } = options;

  const result: ImportResult = {
    target,
    rowsImported: 0,
    rowsSkipped: 0,
    errors: [],
  };

  // Validate target file
  const targetPath = path.join(LEXICONS_DIR, target);
  if (!target.endsWith(".tsv") || target.includes("..") || target.includes("/")) {
    result.errors.push(`Invalid target file: ${target}`);
    return result;
  }
  if (!fs.existsSync(targetPath)) {
    result.errors.push(`Target file does not exist: ${target}`);
    return result;
  }

  // Read target headers
  const targetContent = await fs.promises.readFile(targetPath, "utf8");
  const targetFirstLine = targetContent.split(/\r?\n/)[0] ?? "";
  const targetHeaders = targetFirstLine.split("\t").map((h) => h.trim());

  // Parse incoming data
  const delimiter = detectDelimiter(content.split(/\r?\n/)[0] ?? "");
  const { headers: incomingHeaders, rows: incomingRows } = parseDelimited(
    content,
    delimiter
  );

  if (incomingHeaders.length === 0) {
    result.errors.push("No headers found in import data");
    return result;
  }
  if (incomingRows.length === 0) {
    result.errors.push("No data rows found in import data");
    return result;
  }

  // Map columns
  const { mapping, unmapped } = mapHeaders(incomingHeaders, targetHeaders);
  if (mapping.size === 0) {
    result.errors.push(
      `No matching columns found. Expected: ${targetHeaders.join(", ")}`
    );
    return result;
  }
  if (unmapped.length > 0) {
    result.errors.push(
      `Unmapped columns (ignored): ${unmapped.join(", ")}`
    );
  }

  // Create backup before modifying
  result.backupPath = await createBackup(targetPath);

  if (mode === "replace") {
    // Build new file with target headers + remapped rows
    const remappedRows = incomingRows.map((row) =>
      remapRow(row, mapping, targetHeaders.length)
    );

    const lines = [
      targetHeaders.join("\t"),
      ...remappedRows.map((r) => r.join("\t")),
    ];
    const tempFile = `${targetPath}.tmp`;
    await fs.promises.writeFile(tempFile, lines.join("\n") + "\n", "utf8");
    await fs.promises.rename(tempFile, targetPath);
    result.rowsImported = remappedRows.length;
  } else {
    // Append mode
    const existingIds = skipDuplicates
      ? await readExistingIds(targetPath)
      : new Set<string>();

    // Find which incoming column maps to the first target column (id)
    const idSourceIdx = [...mapping.entries()].find(
      ([, dstIdx]) => dstIdx === 0
    )?.[0];

    const newRows: string[] = [];
    for (const row of incomingRows) {
      // Check for duplicate IDs
      if (skipDuplicates && idSourceIdx !== undefined) {
        const id = row[idSourceIdx]?.trim();
        if (id && existingIds.has(id)) {
          result.rowsSkipped++;
          continue;
        }
        if (id) existingIds.add(id);
      }

      const remapped = remapRow(row, mapping, targetHeaders.length);
      newRows.push(remapped.join("\t"));
    }

    if (newRows.length > 0) {
      // Ensure existing file ends with newline
      const existingContent = await fs.promises.readFile(targetPath, "utf8");
      const prefix = existingContent.endsWith("\n") ? "" : "\n";
      await fs.promises.appendFile(
        targetPath,
        prefix + newRows.join("\n") + "\n",
        "utf8"
      );
    }

    result.rowsImported = newRows.length;
  }

  return result;
}
