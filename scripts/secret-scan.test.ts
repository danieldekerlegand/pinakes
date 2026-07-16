/**
 * Tests for the US-003 secret scanner. The pure core `scanForSecrets` is driven
 * with in-memory files so no git/filesystem/network is touched. Fake secrets are
 * assembled at runtime from fragments so this file holds no literal key (belt +
 * suspenders on top of the scanner's own allowlist for this path).
 */
import { describe, expect, it } from "vitest";
import {
  isEnvSecretFile,
  isScannablePath,
  scanForSecrets,
  shannonEntropy,
  type ScanFile,
} from "./secret-scan";

// Assemble planted secrets without ever writing a literal key in this file.
const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE"; // AKIA + 16 caps
const GOOGLE_KEY = "AIza" + "Sy" + "b".repeat(33); // AIza + 35 chars
const GH_TOKEN = "ghp_" + "b".repeat(40);
const HIGH_ENTROPY = "aB3xK9qL2mZ7wR5tV1nP8cY4dF6gH0jS"; // mixed-class, len 32

describe("scanForSecrets", () => {
  it("passes clean on ordinary source", () => {
    const files: ScanFile[] = [
      { path: "server/routes.ts", content: "export const port = 5000;\n" },
      {
        path: "client/src/lib/scraping.ts",
        content: "const url = '/api/translate';\nconst key = process.env.FOO;\n",
      },
    ];
    expect(scanForSecrets(files)).toEqual([]);
  });

  it("flags a committed .env file by path regardless of content", () => {
    const findings = scanForSecrets([{ path: ".env", content: "PORT=5000\n" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("dotenv-file");
  });

  it("does NOT flag .env.example / templates", () => {
    expect(
      scanForSecrets([{ path: ".env.example", content: "NEO4J_PASSWORD=pinakes\n" }]),
    ).toEqual([]);
    expect(isEnvSecretFile(".env.example")).toBe(false);
    expect(isEnvSecretFile(".env")).toBe(true);
    expect(isEnvSecretFile(".env.production")).toBe(true);
  });

  it("detects a planted AWS access key", () => {
    const findings = scanForSecrets([
      { path: "config/aws.ts", content: `const id = "${AWS_KEY}";\n` },
    ]);
    expect(findings.map((f) => f.rule)).toContain("aws-access-key-id");
  });

  it("detects a planted Google API key", () => {
    const findings = scanForSecrets([
      { path: "config.ts", content: `const k = "${GOOGLE_KEY}";\n` },
    ]);
    expect(findings.map((f) => f.rule)).toContain("google-api-key");
  });

  it("detects a planted GitHub token", () => {
    const findings = scanForSecrets([
      { path: "ci.sh", content: `TOKEN=${GH_TOKEN}\n` },
    ]);
    expect(findings.map((f) => f.rule)).toContain("github-token");
  });

  it("detects a private-key block", () => {
    const findings = scanForSecrets([
      {
        path: "key.pem",
        content: "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n",
      },
    ]);
    expect(findings.map((f) => f.rule)).toContain("private-key-block");
  });

  it("detects a secret-named var with a high-entropy value", () => {
    const findings = scanForSecrets([
      { path: "app.ts", content: `const API_KEY = "${HIGH_ENTROPY}";\n` },
    ]);
    expect(findings.map((f) => f.rule)).toContain("generic-secret-assignment");
  });

  it("does NOT flag secret-named vars with placeholder / env-ref values", () => {
    const files: ScanFile[] = [
      { path: "a.ts", content: "const apiKey = process.env.GEMINI_API_KEY;\n" },
      { path: "b.ts", content: 'const password = "changeme";\n' },
      { path: "c.env.example", content: "SECRET_TOKEN=your-token-here\n" },
      { path: "d.ts", content: "const token = `${config.token}`;\n" },
      { path: "e.ts", content: 'const apiKey = "";\n' },
    ];
    expect(scanForSecrets(files)).toEqual([]);
  });

  it("does NOT flag low-entropy dictionary-word secrets (e.g. .env.example password)", () => {
    // The literal value from .env.example must never trip the generic rule.
    const findings = scanForSecrets([
      { path: "note.md", content: "password: pinakes\n" },
    ]);
    expect(findings).toEqual([]);
  });

  it("honours an inline secret-scan:allow marker", () => {
    const findings = scanForSecrets([
      {
        path: "sample.ts",
        content: `const API_KEY = "${HIGH_ENTROPY}"; // secret-scan:allow\n`,
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("masks the matched secret in findings (never re-leaks it)", () => {
    const findings = scanForSecrets([
      { path: "config.ts", content: `const k = "${GOOGLE_KEY}";\n` },
    ]);
    expect(findings[0].match).not.toContain(GOOGLE_KEY);
    expect(findings[0].match).toContain("…");
  });

  it("skips binary and lockfile paths", () => {
    expect(isScannablePath("assets/logo.png")).toBe(false);
    expect(isScannablePath("package-lock.json")).toBe(false);
    expect(isScannablePath("node_modules/foo/index.js")).toBe(false);
    expect(isScannablePath("server/routes.ts")).toBe(true);
  });
});

describe("shannonEntropy", () => {
  it("scores random strings higher than repeated ones", () => {
    expect(shannonEntropy("aaaaaaaa")).toBeLessThan(1);
    expect(shannonEntropy(HIGH_ENTROPY)).toBeGreaterThan(3.5);
  });
});
