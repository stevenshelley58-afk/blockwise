import { DeterministicResearchQueue } from "./queue.ts";
import type { ResearchJob, ResearchJobInput, ResearchJobKind, SkillRunResult } from "./types.ts";

export type ResearchWorkerContext = {
  enqueue(input: ResearchJobInput): void;
  log(message: string, metadata?: Record<string, unknown>): void;
};

export type ResearchJobHandler<K extends ResearchJobKind = ResearchJobKind> = (
  job: Extract<ResearchJob, { kind: K }>,
  context: ResearchWorkerContext,
) => Promise<SkillRunResult>;

export type ResearchJobHandlers = Partial<Record<ResearchJobKind, ResearchJobHandler>>;

export type WorkOnceResult =
  | { status: "idle"; releasedDeferred: number }
  | { status: "handled"; jobId: string; kind: ResearchJobKind; result: SkillRunResult };

export class ResearchQueueWorker {
  constructor(
    private readonly queue: DeterministicResearchQueue,
    private readonly handlers: ResearchJobHandlers,
    private readonly workerId: string,
    private readonly logger: (message: string, metadata?: Record<string, unknown>) => void = () => undefined,
  ) {}

  async workOnce(): Promise<WorkOnceResult> {
    const releasedDeferred = this.queue.releaseDeferred();
    const job = this.queue.claimNext(this.workerId);
    if (!job) return { status: "idle", releasedDeferred };

    const handler = this.handlers[job.kind];
    if (!handler) {
      const result: SkillRunResult = {
        status: "failed",
        error: `No Hermes handler registered for ${job.kind}`,
        retryable: false,
      };
      this.queue.fail(job.id, result);
      return { status: "handled", jobId: job.id, kind: job.kind, result };
    }

    const enqueued: ResearchJobInput[] = [];
    const context: ResearchWorkerContext = {
      enqueue: (input) => enqueued.push(input),
      log: this.logger,
    };

    let result: SkillRunResult;
    try {
      result = await handler(job as never, context);
    } catch (err) {
      result = {
        status: "failed",
        error: (err as Error).message,
        retryable: true,
      };
    }

    const followUps = [
      ...("enqueue" in result && result.enqueue ? result.enqueue : []),
      ...enqueued,
    ];
    for (const followUp of followUps) this.queue.enqueue(followUp);

    if (result.status === "succeeded") {
      this.queue.complete(job.id, result);
    } else if (result.status === "deferred") {
      this.queue.defer(job.id, result);
    } else {
      this.queue.fail(job.id, result);
    }

    return { status: "handled", jobId: job.id, kind: job.kind, result };
  }
}
