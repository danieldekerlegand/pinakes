import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  analyzeTsvFiles,
  runBatchEnrichment,
  getEnrichmentJob,
  getAllEnrichmentJobs,
  type TsvFileInfo,
} from "./batch-enrichment";

// Mock the Google Generative AI module
const mockGenerateContent = vi.fn();
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
  SchemaType: {
    OBJECT: "OBJECT",
    ARRAY: "ARRAY",
    STRING: "STRING",
  },
}));

const TEST_DIR = "data/source/lexicons";

function writeTestTsv(filename: string, headers: string[], rows: string[][]): string {
  const filePath = path.join(TEST_DIR, filename);
  const content =
    headers.join("\t") + "\n" + rows.map((r) => r.join("\t")).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

const testFiles: string[] = [];

describe("batch-enrichment", () => {
  describe("analyzeTsvFiles", () => {
    it("returns under-populated TSV files sorted by row count", () => {
      const results = analyzeTsvFiles(100);

      // Should find at least some under-populated files in data/source/lexicons/
      expect(Array.isArray(results)).toBe(true);

      // All should have fewer rows than threshold
      for (const info of results) {
        expect(info.rowCount).toBeLessThan(100);
        expect(info.filename).toMatch(/\.tsv$/);
        expect(info.headers.length).toBeGreaterThan(0);
        expect(typeof info.populationScore).toBe("number");
        expect(info.populationScore).toBeGreaterThanOrEqual(0);
        expect(info.populationScore).toBeLessThanOrEqual(100);
      }

      // Should be sorted ascending by row count
      for (let i = 1; i < results.length; i++) {
        expect(results[i].rowCount).toBeGreaterThanOrEqual(results[i - 1].rowCount);
      }
    });

    it("respects the threshold parameter", () => {
      const low = analyzeTsvFiles(10);
      const high = analyzeTsvFiles(100);

      // Higher threshold should include all files from lower threshold plus more
      expect(high.length).toBeGreaterThanOrEqual(low.length);
    });

    it("includes empty field counts per column", () => {
      const results = analyzeTsvFiles(100);
      if (results.length === 0) return;

      const info = results[0];
      expect(info.emptyFieldCounts).toBeDefined();
      for (const header of info.headers) {
        expect(typeof info.emptyFieldCounts[header]).toBe("number");
      }
    });

    it("identifies known under-populated files", () => {
      const results = analyzeTsvFiles(100);
      const filenames = results.map((r) => r.filename);

      // Files still under the 100-row threshold. Enrichment legitimately lifts a
      // file out of this set — cuisines.tsv crossed it — so the literal list is a
      // floor only, and the invariant below is what actually pins the behaviour.
      const knownSmallFiles = [
        "literary-traditions.tsv",
        "music-traditions.tsv",
        "religions.tsv",
      ];

      for (const small of knownSmallFiles) {
        expect(filenames).toContain(small);
      }

      // Whatever the corpus looks like, the analyzer only reports files below the
      // threshold it was asked for.
      for (const info of results) {
        expect(info.rowCount).toBeLessThan(100);
      }
    });
  });

  describe("runBatchEnrichment", () => {
    const originalEnv = process.env.GEMINI_API_KEY;

    beforeEach(() => {
      mockGenerateContent.mockReset();
    });

    afterEach(() => {
      process.env.GEMINI_API_KEY = originalEnv;
      for (const f of testFiles) {
        try { fs.unlinkSync(f); } catch {}
      }
      testFiles.length = 0;
    });

    function createTestTsv(name: string, headers: string[], rows: string[][]): string {
      const fp = writeTestTsv(`__test_${name}__.tsv`, headers, rows);
      testFiles.push(fp);
      return `__test_${name}__.tsv`;
    }

    function mockGeminiResponse(entries: Record<string, string>[]) {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({ entries }),
        },
      });
    }

    it("creates a job with proper status tracking", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const filename = createTestTsv("data", ["id", "name", "description"], [["test-1", "Test One", "A test entry"]]);
      mockGeminiResponse([{ id: "test-2", name: "Test Two", description: "Another test" }]);

      const job = await runBatchEnrichment({ targetFiles: [filename], batchesPerFile: 1 });

      expect(job.id).toMatch(/^enrich_/);
      expect(job.status).toBe("completed");
      expect(job.completedFiles).toBe(1);
      expect(job.totalFiles).toBe(1);
      expect(job.startedAt).toBeTruthy();
      expect(job.completedAt).toBeTruthy();
    });

    it("tracks job in the job store", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const filename = createTestTsv("track", ["id", "name"], [["t-1", "One"]]);
      mockGeminiResponse([{ id: "t-2", name: "Two" }]);

      const job = await runBatchEnrichment({ targetFiles: [filename], batchesPerFile: 1 });

      const retrieved = getEnrichmentJob(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(job.id);
      expect(retrieved!.status).toBe("completed");

      const all = getAllEnrichmentJobs();
      expect(all.some((j) => j.id === job.id)).toBe(true);
    });

    it("handles missing files gracefully", async () => {
      process.env.GEMINI_API_KEY = "test-key";

      const job = await runBatchEnrichment({ targetFiles: ["nonexistent-file.tsv"], batchesPerFile: 1 });

      expect(job.errors.length).toBeGreaterThan(0);
      expect(job.errors[0]).toContain("File not found");
    });

    it("fails when GEMINI_API_KEY is missing", async () => {
      delete process.env.GEMINI_API_KEY;
      const filename = createTestTsv("nokey", ["id", "name"], [["t-1", "One"]]);

      const job = await runBatchEnrichment({ targetFiles: [filename], batchesPerFile: 1 });

      expect(job.errors.length).toBeGreaterThan(0);
      expect(job.status).toBe("failed");
    });

    it("calls progress callback", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const filename = createTestTsv("progress", ["id", "name"], [["t-1", "One"]]);
      mockGeminiResponse([{ id: "t-2", name: "Two" }]);

      const messages: string[] = [];
      await runBatchEnrichment({
        targetFiles: [filename],
        batchesPerFile: 1,
        onProgress: (msg) => messages.push(msg),
      });

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.includes("Starting enrichment"))).toBe(true);
      expect(messages.some((m) => m.includes("Enriching"))).toBe(true);
    });

    it("deduplicates entries with existing IDs", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const filename = createTestTsv("dedup", ["id", "name", "description"], [["existing-1", "Existing", "Already here"]]);
      mockGeminiResponse([
        { id: "existing-1", name: "Duplicate", description: "Should be skipped" },
        { id: "new-1", name: "New Entry", description: "Should be added" },
      ]);

      const job = await runBatchEnrichment({ targetFiles: [filename], batchesPerFile: 1 });

      const content = fs.readFileSync(path.join(TEST_DIR, filename), "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      // Header + existing + new (duplicate skipped)
      expect(lines.length).toBe(3);
      expect(content).toContain("new-1");
      expect(job.totalNewRows).toBe(1);
    });
  });
});
