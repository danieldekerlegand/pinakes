/**
 * Secret scanner (US-003) — a self-contained, zero-dependency guard that blocks
 * committing `.env` files or key-like / high-entropy secrets.
 *
 * Why a hand-rolled TS scanner instead of the gitleaks/trufflehog binary: this
 * repo's toolchain is TS + vitest with no external binaries in CI, and the
 * "fails on a planted test secret" acceptance is far easier to prove
 * deterministically with a pure function under vitest than by shelling out to a
 * binary that may or may not be installed. The rule set below is intentionally
 * high-confidence (provider-prefixed keys, private-key blocks, and secret-named
 * assignments with a real high-entropy value) so it passes cleanly on the whole
 * current tree yet trips on a genuine leak.
 *
 * Used two ways (see docs/SECURITY.md "Secret scanning"):
 *   • pre-commit hook  — `.githooks/pre-commit` runs `--staged` (only what's about
 *     to be committed); install with `git config core.hooksPath .githooks` (the
 *     `prepare` npm script does this automatically after `npm install`).
 *   • CI               — `.github/workflows/secret-scan.yml` runs a full-tree scan.
 *
 * Run manually:
 *   npm run secret-scan          # scan the whole tracked tree (CI mode)
 *   npm run secret-scan:staged   # scan only staged changes (what the hook runs)
 *
 * The pure core `scanForSecrets(files)` takes `{path, content}[]` and returns
 * findings — network- and filesystem-free, so tests drive it directly.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** One file handed to the scanner. */
export interface ScanFile {
  path: string;
  content: string;
}

/** One detected secret. */
export interface Finding {
  path: string;
  /** 1-based line number (0 for whole-file/path findings). */
  line: number;
  rule: string;
  /** Human-readable reason. */
  message: string;
  /** The offending text, masked so the finding itself never leaks the secret. */
  match: string;
}

/** A single content rule: a name + a regex whose match is a candidate secret. */
interface ContentRule {
  rule: string;
  message: string;
  regex: RegExp;
  /** Optional extra gate on the captured value (e.g. entropy). */
  accept?: (value: string) => boolean;
}

/**
 * Inline escape hatch — a line containing this marker is skipped (mirrors
 * gitleaks' `# gitleaks:allow`). Use sparingly for known-safe sample values.
 */
const ALLOW_MARKERS = ["secret-scan:allow", "gitleaks:allow"];

/**
 * Paths the scanner never inspects. `.env.example`/`*.example` hold intentional
 * template values (e.g. `NEO4J_PASSWORD=pinakes`); lockfiles are giant hash
 * blobs; the scanner + its test legitimately contain rule patterns and planted
 * fixtures. Everything here is matched against the repo-relative path.
 */
const ALLOWLISTED_PATHS = new Set<string>([
  "scripts/secret-scan.ts",
  "scripts/secret-scan.test.ts",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/** Directory prefixes never scanned. */
const ALLOWLISTED_DIR_PREFIXES = ["node_modules/", ".git/", "dist/", "build/"];

/** Binary-ish extensions we skip (never secrets, and noisy to read as text). */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "pdf", "woff", "woff2",
  "ttf", "eot", "otf", "mp4", "mov", "webm", "zip", "gz", "tgz", "wasm",
  "duckdb", "db", "sqlite", "parquet",
]);

/**
 * Placeholder values that are safe even when assigned to a secret-named var.
 * These keep template/config/sample lines from tripping the generic rule.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\s*$/, // empty
  /process\.env/i,
  /import\.meta\.env/i,
  /os\.environ/i,
  /\$\{/, // interpolation / shell var
  /\$[A-Z_]/, // shell var reference
  /</, // <your-key-here> style
  /\b(your|example|sample|placeholder|changeme|change-me|dummy|fake|test|redacted|xxx+|todo|none|null|undefined|replace)\b/i,
  /^[*.•xX]+$/, // masked
];

/**
 * Shannon entropy (bits/char). Real keys are high-entropy; English words and
 * dotted config values are low. Used to gate the generic assignment rule.
 */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** True when a captured value looks like a real secret, not a placeholder. */
function looksLikeRealSecret(value: string): boolean {
  const v = value.trim().replace(/^['"]|['"]$/g, "");
  if (v.length < 20) return false;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(v))) return false;
  // Require a genuine character mix (a long lowercase-only word is not a key)
  // OR high raw entropy.
  const hasLower = /[a-z]/.test(v);
  const hasUpper = /[A-Z]/.test(v);
  const hasDigit = /[0-9]/.test(v);
  const classes = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
  if (shannonEntropy(v) >= 3.5 && (classes >= 2 || /[+/=_-]/.test(v))) return true;
  return false;
}

/** High-confidence content rules, roughly the gitleaks default core set. */
const CONTENT_RULES: ContentRule[] = [
  {
    rule: "aws-access-key-id",
    message: "AWS access key id",
    regex: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    rule: "google-api-key",
    message: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    rule: "openai-anthropic-key",
    message: "OpenAI/Anthropic-style secret key",
    regex: /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    rule: "github-token",
    message: "GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    rule: "slack-token",
    message: "Slack token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    rule: "google-oauth-secret",
    message: "Google OAuth client secret",
    regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    rule: "private-key-block",
    message: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    rule: "generic-secret-assignment",
    message: "Secret-named variable assigned a high-entropy value",
    // key name → optional quote → value (captured)
    regex:
      /\b(?:api[_-]?key|secret|secret[_-]?key|access[_-]?key|auth[_-]?token|token|password|passwd|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']?([A-Za-z0-9+/_=-]{20,})["']?/i,
    accept: looksLikeRealSecret,
  },
];

/** Mask a secret so the report never re-leaks it. */
function mask(text: string): string {
  const t = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  if (t.length <= 8) return "****";
  return `${t.slice(0, 4)}…${t.slice(-2)}`;
}

/** Does this path look like a real `.env` (not a template/sample)? */
export function isEnvSecretFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (!base.startsWith(".env")) return false;
  // Templates are safe: .env.example, .env.sample, .env.*.example, .env.template
  if (/\.(example|sample|template|dist)$/i.test(base)) return false;
  return true;
}

/** Should this path be scanned at all? */
export function isScannablePath(path: string): boolean {
  if (ALLOWLISTED_PATHS.has(path)) return false;
  if (ALLOWLISTED_DIR_PREFIXES.some((p) => path.startsWith(p))) return false;
  const base = path.split("/").pop() ?? path;
  if (/\.(example|sample|template)$/i.test(base)) return false;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return true;
}

/**
 * Pure scan core. Returns every finding across the supplied files. `.env`-style
 * files are flagged by path (regardless of content); everything else is scanned
 * line-by-line against the content rules.
 */
export function scanForSecrets(files: ScanFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    // Path rule: never allow a real .env into a commit.
    if (isEnvSecretFile(file.path)) {
      findings.push({
        path: file.path,
        line: 0,
        rule: "dotenv-file",
        message:
          "Environment file must not be committed (add to .gitignore; use .env.example)",
        match: file.path,
      });
      // Still fall through to content rules would be redundant/noisy — skip.
      continue;
    }
    if (!isScannablePath(file.path)) continue;

    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (ALLOW_MARKERS.some((m) => line.includes(m))) continue;
      for (const rule of CONTENT_RULES) {
        const m = rule.regex.exec(line);
        if (!m) continue;
        const captured = m[1] ?? m[0];
        if (rule.accept && !rule.accept(captured)) continue;
        findings.push({
          path: file.path,
          line: i + 1,
          rule: rule.rule,
          message: rule.message,
          match: mask(m[0]),
        });
      }
    }
  }
  return findings;
}

// ─────────────────────────── git / filesystem I/O ───────────────────────────

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Read a file as UTF-8, returning "" for unreadable/binary reads. */
function safeRead(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Collect the staged (about-to-be-committed) files and their staged content. */
export function collectStagedFiles(): ScanFile[] {
  const out = git([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACM",
    "-z",
  ]);
  const paths = out.split("\0").filter(Boolean);
  const files: ScanFile[] = [];
  for (const path of paths) {
    let content = "";
    try {
      // Read the STAGED blob, not the working tree — that's what will land.
      content = git(["show", `:${path}`]);
    } catch {
      content = safeRead(path);
    }
    files.push({ path, content });
  }
  return files;
}

/** Collect every tracked file's working-tree content (CI / full-tree scan). */
export function collectTrackedFiles(): ScanFile[] {
  const out = git(["ls-files", "-z"]);
  const paths = out.split("\0").filter(Boolean);
  return paths.map((path) => ({ path, content: safeRead(path) }));
}

/** Format findings for the terminal. */
function report(findings: Finding[]): string {
  const lines = ["", "🔒 Secret scan found potential secrets:", ""];
  for (const f of findings) {
    const loc = f.line ? `${f.path}:${f.line}` : f.path;
    lines.push(`  ✗ ${loc}  [${f.rule}]`);
    lines.push(`      ${f.message}`);
    lines.push(`      match: ${f.match}`);
  }
  lines.push("");
  lines.push(
    "Remove the secret (or move it to an untracked .env). If this is a false",
  );
  lines.push(
    "positive, append an inline `secret-scan:allow` comment to that line, or",
  );
  lines.push("allowlist the path in scripts/secret-scan.ts. See docs/SECURITY.md.");
  lines.push("");
  return lines.join("\n");
}

/** CLI entry. Returns the process exit code (0 = clean, 1 = secrets found). */
export function main(argv: string[]): number {
  const staged = argv.includes("--staged");
  const files = staged ? collectStagedFiles() : collectTrackedFiles();
  const findings = scanForSecrets(files);
  if (findings.length > 0) {
    // eslint-disable-next-line no-console
    console.error(report(findings));
    return 1;
  }
  // eslint-disable-next-line no-console
  console.log(
    `✓ Secret scan clean (${files.length} ${staged ? "staged" : "tracked"} file(s) checked).`,
  );
  return 0;
}

// Main-module guard — mirrors smoke-graph.ts / reconciliation-report.ts.
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))
) {
  process.exit(main(process.argv.slice(2)));
}
