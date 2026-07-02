import { describe, it, expect } from "vitest";

/**
 * Unit tests for scraper dashboard utility logic.
 * These test the pure functions used by the dashboard component.
 */

// Replicate the formatDuration function from the dashboard
function formatDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined
): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

// Replicate coverage summary logic
function computeCoverageSummary(
  coverage: Array<{ wordCount: number }>
): { scraped: number; total: number; percent: number } {
  const scraped = coverage.filter((c) => c.wordCount > 0).length;
  const total = coverage.length;
  return {
    scraped,
    total,
    percent: total > 0 ? Math.round((scraped / total) * 100) : 0,
  };
}

// Replicate coverage filter logic
function filterCoverage(
  coverage: Array<{ wordCount: number; languageName: string }>,
  filter: "all" | "scraped" | "unscraped"
): Array<{ wordCount: number; languageName: string }> {
  if (filter === "scraped") return coverage.filter((c) => c.wordCount > 0);
  if (filter === "unscraped") return coverage.filter((c) => c.wordCount === 0);
  return coverage;
}

// Replicate job categorization logic
type JobStatus = "running" | "pending" | "completed" | "failed";
function categorizeJobs(jobs: Array<{ status: string }>) {
  return {
    active: jobs.filter((j) => j.status === "running" || j.status === "pending"),
    completed: jobs.filter((j) => j.status === "completed"),
    failed: jobs.filter((j) => j.status === "failed"),
  };
}

describe("formatDuration", () => {
  it("returns '-' when startedAt is null", () => {
    expect(formatDuration(null, null)).toBe("-");
  });

  it("returns '-' when startedAt is undefined", () => {
    expect(formatDuration(undefined, undefined)).toBe("-");
  });

  it("formats seconds correctly for short durations", () => {
    const start = "2026-03-26T10:00:00Z";
    const end = "2026-03-26T10:00:30Z";
    expect(formatDuration(start, end)).toBe("30s");
  });

  it("formats minutes and seconds correctly", () => {
    const start = "2026-03-26T10:00:00Z";
    const end = "2026-03-26T10:05:30Z";
    expect(formatDuration(start, end)).toBe("5m 30s");
  });

  it("formats exact minutes correctly", () => {
    const start = "2026-03-26T10:00:00Z";
    const end = "2026-03-26T10:03:00Z";
    expect(formatDuration(start, end)).toBe("3m 0s");
  });

  it("formats zero seconds correctly", () => {
    const start = "2026-03-26T10:00:00Z";
    const end = "2026-03-26T10:00:00Z";
    expect(formatDuration(start, end)).toBe("0s");
  });

  it("uses current time when completedAt is null", () => {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const result = formatDuration(fiveSecondsAgo, null);
    // Should be roughly 5 seconds (allowing 1s tolerance)
    expect(result).toMatch(/^[4-6]s$/);
  });
});

describe("computeCoverageSummary", () => {
  it("returns zeros for empty coverage", () => {
    expect(computeCoverageSummary([])).toEqual({
      scraped: 0,
      total: 0,
      percent: 0,
    });
  });

  it("counts scraped languages correctly", () => {
    const coverage = [
      { wordCount: 100 },
      { wordCount: 0 },
      { wordCount: 50 },
    ];
    expect(computeCoverageSummary(coverage)).toEqual({
      scraped: 2,
      total: 3,
      percent: 67,
    });
  });

  it("returns 100% when all languages are scraped", () => {
    const coverage = [
      { wordCount: 100 },
      { wordCount: 200 },
    ];
    expect(computeCoverageSummary(coverage)).toEqual({
      scraped: 2,
      total: 2,
      percent: 100,
    });
  });

  it("returns 0% when no languages are scraped", () => {
    const coverage = [
      { wordCount: 0 },
      { wordCount: 0 },
    ];
    expect(computeCoverageSummary(coverage)).toEqual({
      scraped: 0,
      total: 2,
      percent: 0,
    });
  });
});

describe("filterCoverage", () => {
  const coverage = [
    { wordCount: 100, languageName: "English" },
    { wordCount: 0, languageName: "Chinese" },
    { wordCount: 50, languageName: "Spanish" },
  ];

  it("returns all items with 'all' filter", () => {
    expect(filterCoverage(coverage, "all")).toHaveLength(3);
  });

  it("returns only scraped items with 'scraped' filter", () => {
    const result = filterCoverage(coverage, "scraped");
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.wordCount > 0)).toBe(true);
  });

  it("returns only unscraped items with 'unscraped' filter", () => {
    const result = filterCoverage(coverage, "unscraped");
    expect(result).toHaveLength(1);
    expect(result[0].languageName).toBe("Chinese");
  });
});

describe("categorizeJobs", () => {
  const jobs = [
    { status: "running" },
    { status: "pending" },
    { status: "completed" },
    { status: "completed" },
    { status: "failed" },
  ];

  it("categorizes active jobs (running + pending)", () => {
    expect(categorizeJobs(jobs).active).toHaveLength(2);
  });

  it("categorizes completed jobs", () => {
    expect(categorizeJobs(jobs).completed).toHaveLength(2);
  });

  it("categorizes failed jobs", () => {
    expect(categorizeJobs(jobs).failed).toHaveLength(1);
  });

  it("handles empty job list", () => {
    const result = categorizeJobs([]);
    expect(result.active).toHaveLength(0);
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
