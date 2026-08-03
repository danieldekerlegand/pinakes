import type { ScrapingJob } from "@contracts/types";

/**
 * In-memory job store for tracking scraping jobs
 * Jobs are stored in memory and don't persist across server restarts
 */
class JobStore {
  private jobs: Map<string, ScrapingJob> = new Map();
  private idCounter = 0;

  /**
   * Create a new scraping job
   */
  createJob(languageId: string, totalWords: number, dataSource?: string): ScrapingJob {
    const id = `job_${Date.now()}_${++this.idCounter}`;
    const job: ScrapingJob = {
      id,
      languageId,
      status: "pending",
      totalWords,
      completedWords: 0,
      failedWords: 0,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      dataSource: (dataSource as any) || "gemini",
      outputPath: null,
      wordCount: null,
      apiCallsUsed: null,
    };

    this.jobs.set(id, job);
    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): ScrapingJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get all jobs (sorted by creation date, newest first)
   */
  getAllJobs(): ScrapingJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  /**
   * Update a job
   */
  updateJob(id: string, updates: Partial<ScrapingJob>): ScrapingJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const updatedJob = { ...job, ...updates };
    this.jobs.set(id, updatedJob);
    return updatedJob;
  }

  /**
   * Delete a job
   */
  deleteJob(id: string): boolean {
    return this.jobs.delete(id);
  }

  /**
   * Clean up old completed jobs (keep last 50)
   */
  cleanup(): void {
    const allJobs = this.getAllJobs();
    const completedJobs = allJobs.filter(
      (j) => j.status === "completed" || j.status === "failed"
    );

    // Keep only the 50 most recent completed jobs
    if (completedJobs.length > 50) {
      const toDelete = completedJobs.slice(50);
      toDelete.forEach((job) => this.deleteJob(job.id));
    }
  }
}

export const jobStore = new JobStore();
