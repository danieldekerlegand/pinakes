/**
 * Client-side raw-DNA file parser (US-001, DNA-to-culture ancestry mapper).
 *
 * Parses the two common consumer raw-data exports — **23andMe** and **AncestryDNA** —
 * into a normalized list of SNP calls. Everything here is a pure string transform with
 * no I/O: the caller reads the file with the browser `FileReader`, hands us the text,
 * and NOTHING is ever uploaded or persisted. That privacy guarantee is the whole point
 * of doing this in the browser (see AC: "all processing in-browser; nothing uploaded").
 *
 * The two formats:
 *  - 23andMe:    `rsid <tab> chromosome <tab> position <tab> genotype`   (genotype e.g. "AA")
 *  - AncestryDNA:`rsid <tab> chromosome <tab> position <tab> allele1 <tab> allele2`
 * Both are tab-separated, prefixed by `#` comment lines, and AncestryDNA carries a
 * literal `rsid`-led header row. Chromosomes are normalized to `1..22`, `X`, `Y`, `MT`
 * (AncestryDNA numbers them 23=X, 24=Y, 25=X-PAR, 26=MT).
 */

export type DnaFormat = "23andme" | "ancestrydna" | "unknown";

export interface Snp {
  rsid: string;
  /** Normalized chromosome: "1".."22" | "X" | "Y" | "MT". */
  chromosome: string;
  /** Concatenated non-missing allele calls, e.g. "AA", "C". "" when fully no-call. */
  genotype: string;
}

export interface ParsedDna {
  format: DnaFormat;
  snps: Snp[];
  /** Fast lookup by rsid (last write wins on duplicate rsids). */
  byRsid: Map<string, Snp>;
  counts: {
    total: number;
    yChromosome: number;
    mtDna: number;
  };
}

/** Missing / no-call tokens used across both vendors. */
const NO_CALL = new Set(["--", "-", "0", "00", "I", "D", "DD", "II", "DI", "ID"]);

/** Normalize a vendor chromosome token to the canonical `1..22|X|Y|MT`. */
function normalizeChromosome(raw: string): string {
  const c = raw.trim().toUpperCase();
  switch (c) {
    case "23":
      return "X";
    case "24":
      return "Y";
    case "25":
      // AncestryDNA pseudo-autosomal region of X.
      return "X";
    case "26":
      return "MT";
    case "M":
    case "MT":
      return "MT";
    case "X":
    case "Y":
      return c;
    default:
      return c;
  }
}

/** Collapse a genotype/allele pair to the concatenated non-missing calls. */
function normalizeGenotype(tokens: string[]): string {
  const letters: string[] = [];
  for (const token of tokens) {
    const t = token.trim().toUpperCase();
    if (!t || NO_CALL.has(t)) continue;
    // 23andMe genotype cells are already the concatenated call (e.g. "AA"); split them.
    for (const ch of t) {
      if (ch === "A" || ch === "C" || ch === "G" || ch === "T") letters.push(ch);
    }
  }
  return letters.join("");
}

/** Detect the vendor from comment headers + the first data row's column count. */
function detectFormat(lines: string[]): DnaFormat {
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const lower = line.toLowerCase();
    if (lower.includes("ancestrydna")) return "ancestrydna";
    if (lower.includes("23andme")) return "23andme";
  }
  // Fall back to column count of the first non-comment, non-blank row.
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cols = trimmed.split("\t").length;
    if (cols >= 5) return "ancestrydna";
    if (cols === 4) return "23andme";
    break;
  }
  return "unknown";
}

/**
 * Parse a raw-DNA export into normalized SNP calls. Tolerant of CRLF line endings,
 * blank lines, `#` comments, and an optional `rsid`-led header row. Malformed rows are
 * skipped rather than throwing so a partially-corrupt export still yields usable data.
 */
export function parseDnaFile(text: string): ParsedDna {
  const lines = text.split(/\r?\n/);
  const format = detectFormat(lines);

  const snps: Snp[] = [];
  const byRsid = new Map<string, Snp>();
  let yChromosome = 0;
  let mtDna = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const cols = line.split("\t");
    if (cols.length < 4) continue;

    const rsid = cols[0].trim();
    // Skip the header row that AncestryDNA (and some 23andMe exports) include.
    if (!rsid || rsid.toLowerCase() === "rsid") continue;

    const chromosome = normalizeChromosome(cols[1]);
    // 23andMe: single genotype column at index 3. AncestryDNA: allele1/allele2 at 3/4.
    const genotypeTokens = format === "ancestrydna" ? cols.slice(3, 5) : cols.slice(3, 4);
    const genotype = normalizeGenotype(genotypeTokens);

    const snp: Snp = { rsid, chromosome, genotype };
    snps.push(snp);
    byRsid.set(rsid, snp);
    if (chromosome === "Y") yChromosome += 1;
    if (chromosome === "MT") mtDna += 1;
  }

  return {
    format,
    snps,
    byRsid,
    counts: { total: snps.length, yChromosome, mtDna },
  };
}
