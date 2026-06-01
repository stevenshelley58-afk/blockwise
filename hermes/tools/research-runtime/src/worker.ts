import type { SkillRunResult, SupabaseResearchJob } from "./types.ts";

export type ResearchJobHandler = (job: SupabaseResearchJob) => Promise<SkillRunResult>;

export class ResearchQueueWorker {
  constructor(
    private readonly claim: () => Promise<SupabaseResearchJob | null>,
    private readonly complete: (job: SupabaseResearchJob, result: SkillRunResult) => Promise<void>,
    private readonly handlers: Partial<Record<string, ResearchJobHandler>>,
  ) {}

  async workOnce(): Promise<{ status: "idle" } | { status: "handled"; jobId: string; jobType: string; result: SkillRunResult }> {
    const job = await this.claim();
    if (!job) return { status: "idle" };

    const handler = this.handlers[job.job_type];
    const result = handler
      ? await handler(job)
      : {
          status: "blocked" as const,
          blocked_reason: `unsupported_job_type:${job.job_type}`,
          result: { handler: "none" },
        };

    await this.complete(job, result);
    return { status: "handled", jobId: job.id, jobType: job.job_type, result };
  }
}
