import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  runCultureProfileEnrichment,
  getCultureEnrichmentJob,
  getAllCultureEnrichmentJobs,
  listCultureProfileIds,
} from "./culture-profile-enrichment";

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

const LEXICONS_DIR = "lexicons";
const TARGET_FILES = [
  "culture-profiles.tsv",
  "daily-life.tsv",
  "social-structures.tsv",
  "city-layouts.tsv",
];

function mockEntries(entries: Record<string, string>[]) {
  mockGenerateContent.mockResolvedValue({
    response: { text: () => JSON.stringify({ entries }) },
  });
}

function snapshot(): Map<string, string> {
  const snap = new Map<string, string>();
  for (const f of TARGET_FILES) {
    const p = path.join(LEXICONS_DIR, f);
    snap.set(p, fs.readFileSync(p, "utf8"));
  }
  return snap;
}

function restore(snap: Map<string, string>): void {
  for (const [p, content] of snap.entries()) {
    fs.writeFileSync(p, content, "utf8");
  }
}

describe("culture-profile-enrichment", () => {
  const originalEnv = process.env.GEMINI_API_KEY;
  let snap: Map<string, string>;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    snap = snapshot();
  });

  afterEach(() => {
    restore(snap);
    process.env.GEMINI_API_KEY = originalEnv;
  });

  describe("listCultureProfileIds", () => {
    it("returns non-empty list of profile IDs from culture-profiles.tsv", () => {
      const ids = listCultureProfileIds();
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    });
  });

  describe("runCultureProfileEnrichment", () => {
    it("fails when GEMINI_API_KEY is missing", async () => {
      delete process.env.GEMINI_API_KEY;
      const job = await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian"],
        domains: ["daily-life"],
      });
      expect(job.status).toBe("failed");
      expect(job.errors.some((e) => e.includes("GEMINI_API_KEY"))).toBe(true);
    });

    it("records an error when a profile ID is not found", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockEntries([]);
      const job = await runCultureProfileEnrichment({
        profileIds: ["nonexistent-culture-xyz"],
        domains: ["daily-life"],
        entriesPerDomain: 1,
      });
      expect(job.errors.some((e) => e.includes("not found"))).toBe(true);
      expect(job.totalProfiles).toBe(1);
      expect(job.completedProfiles).toBe(1);
    });

    it("appends generated entries to daily-life.tsv with culture_profile_id and auto ID", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockEntries([
        {
          id: "",
          culture_profile_id: "wrong-id",
          category: "housing",
          title: "Test Housing Pattern",
          description: "A unique housing detail for testing.",
          social_class: "common",
          gender_context: "all",
          age_group: "all",
          season: "all",
          time_period_start: "-3500",
          time_period_end: "-2000",
          sources: "Test Source 2026",
        },
      ]);

      const before = fs.readFileSync(path.join(LEXICONS_DIR, "daily-life.tsv"), "utf8");

      const job = await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian"],
        domains: ["daily-life"],
        entriesPerDomain: 1,
      });

      expect(job.status).toBe("completed");
      expect(job.totalNewRows).toBe(1);
      expect(job.completedProfiles).toBe(1);

      const after = fs.readFileSync(path.join(LEXICONS_DIR, "daily-life.tsv"), "utf8");
      expect(after.length).toBeGreaterThan(before.length);
      expect(after).toContain("Test Housing Pattern");

      const lastLine = after.trim().split("\n").pop() ?? "";
      const cells = lastLine.split("\t");
      expect(cells[0]).toMatch(/^dl-\d{3}$/);
      expect(cells[1]).toBe("cp-sumerian");
    });

    it("assigns unique sequential IDs and does not collide with existing ones", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockEntries([
        { id: "", culture_profile_id: "cp-sumerian", category: "housing", title: "Entry A", description: "A", social_class: "common", gender_context: "all", age_group: "all", season: "all", time_period_start: "-3000", time_period_end: "-2000", sources: "Test" },
        { id: "", culture_profile_id: "cp-sumerian", category: "diet", title: "Entry B", description: "B", social_class: "common", gender_context: "all", age_group: "all", season: "all", time_period_start: "-3000", time_period_end: "-2000", sources: "Test" },
      ]);

      const before = fs.readFileSync(path.join(LEXICONS_DIR, "daily-life.tsv"), "utf8");
      const existingIds = new Set(
        before.split("\n").slice(1).map((l) => l.split("\t")[0]).filter(Boolean)
      );

      const job = await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian"],
        domains: ["daily-life"],
        entriesPerDomain: 2,
      });

      expect(job.totalNewRows).toBe(2);

      const after = fs.readFileSync(path.join(LEXICONS_DIR, "daily-life.tsv"), "utf8");
      const newLines = after.trim().split("\n").slice(-2);
      const newIds = newLines.map((l) => l.split("\t")[0]);
      expect(new Set(newIds).size).toBe(2);
      for (const id of newIds) {
        expect(existingIds.has(id)).toBe(false);
      }
    });

    it("tracks the job in the job store and appears in the list", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockEntries([
        { id: "", culture_profile_id: "cp-sumerian", category: "recreation", title: "Test Game", description: "desc", social_class: "common", gender_context: "all", age_group: "all", season: "all", time_period_start: "-3000", time_period_end: "-2000", sources: "Test" },
      ]);

      const job = await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian"],
        domains: ["daily-life"],
        entriesPerDomain: 1,
      });

      const retrieved = getCultureEnrichmentJob(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(job.id);
      expect(retrieved!.status).toBe("completed");

      const all = getAllCultureEnrichmentJobs();
      expect(all.some((j) => j.id === job.id)).toBe(true);
    });

    it("calls progress callback with start and completion messages", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockEntries([
        { id: "", culture_profile_id: "cp-sumerian", category: "law", title: "Test Law", description: "desc", social_class: "elite", gender_context: "all", age_group: "all", season: "all", time_period_start: "-3000", time_period_end: "-2000", sources: "Test" },
      ]);

      const messages: string[] = [];
      await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian"],
        domains: ["daily-life"],
        entriesPerDomain: 1,
        onProgress: (m) => messages.push(m),
      });

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.includes("Starting culture profile enrichment"))).toBe(true);
      expect(messages.some((m) => m.includes("complete"))).toBe(true);
    });

    it("handles Gemini API errors without aborting other profiles", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockGenerateContent
        .mockRejectedValueOnce(new Error("Simulated API failure"))
        .mockResolvedValue({
          response: {
            text: () => JSON.stringify({
              entries: [
                { id: "", culture_profile_id: "cp-roman", category: "commerce", title: "Test Market", description: "desc", social_class: "common", gender_context: "all", age_group: "all", season: "all", time_period_start: "-100", time_period_end: "100", sources: "Test" },
              ],
            }),
          },
        });

      const job = await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian", "cp-roman"],
        domains: ["daily-life"],
        entriesPerDomain: 1,
      });

      expect(job.errors.some((e) => e.includes("Simulated API failure"))).toBe(true);
      expect(job.totalNewRows).toBe(1);
      expect(job.completedProfiles).toBe(2);
    });

    it("overrides Gemini-provided culture_profile_id with the requested profile", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      mockEntries([
        { id: "dl-999999", culture_profile_id: "cp-wrong", category: "hygiene", title: "Override Test", description: "desc", social_class: "all", gender_context: "all", age_group: "all", season: "all", time_period_start: "-3000", time_period_end: "-2000", sources: "Test" },
      ]);

      await runCultureProfileEnrichment({
        profileIds: ["cp-sumerian"],
        domains: ["daily-life"],
        entriesPerDomain: 1,
      });

      const after = fs.readFileSync(path.join(LEXICONS_DIR, "daily-life.tsv"), "utf8");
      const lastLine = after.trim().split("\n").pop() ?? "";
      const cells = lastLine.split("\t");
      expect(cells[1]).toBe("cp-sumerian");
      expect(cells[0]).not.toBe("dl-999999");
      expect(cells[0]).toMatch(/^dl-\d{3}$/);
    });
  });
});
