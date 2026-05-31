import { createHash } from "node:crypto";

import {
  type ResearchJob,
  type ResearchJobInput,
  type SkillRunResult,
  validateResearchJobInput,
} from "./types.ts";

export type QueueClock = {
  now(): string;
};

export const systemClock: QueueClock = {
  now: () => new Date().toISOString(),
};

export type ResearchQueueSnapshot = {
  schemaVersion: 1;
  jobs: ResearchJob[];
};

export type EnqueueResult = {
  job: ResearchJob;
  inserted: boolean;
};

export class DeterministicResearchQueue {
  private readonly jobs = new Map<string, ResearchJob>();

  constructor(snapshot: ResearchQueueSnapshot = { schemaVersion: 1, jobs: [] }, private readonly clock: QueueClock = systemClock) {
    for (const job of snapshot.jobs) {
      this.jobs.set(job.id, clone(job));
    }
  }

  enqueue(input: ResearchJobInput | unknown, now = this.clock.now()): EnqueueResult {
    const parsed = validateResearchJobInput(input);
    const deterministicKey = jobDeterministicKey(parsed);
    const id = jobIdFor(deterministicKey);
    const existing = this.jobs.get(id);
    if (existing && existing.status !== "failed") {
      return { job: clone(existing), inserted: false };
    }

    const job: ResearchJob = {
      ...parsed,
      id,
      deterministicKey,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      availableAt: parsed.availableAt ?? now,
      lockOwner: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      result: null,
    };
    this.jobs.set(id, job);
    return { job: clone(job), inserted: true };
  }

  claimNext(workerId: string, now = this.clock.now()): ResearchJob | null {
    const eligible = [...this.jobs.values()]
      .filter((job) => job.status === "queued" && Date.parse(job.availableAt) <= Date.parse(now))
      .sort(compareJobs);
    const next = eligible[0];
    if (!next) return null;

    next.status = "running";
    next.attempts += 1;
    next.lockOwner = workerId;
    next.startedAt = now;
    next.updatedAt = now;
    this.jobs.set(next.id, next);
    return clone(next);
  }

  complete(jobId: string, result: Extract<SkillRunResult, { status: "succeeded" }>, now = this.clock.now()): ResearchJob {
    const job = this.requireJob(jobId);
    job.status = "succeeded";
    job.result = clone(result);
    job.lockOwner = null;
    job.finishedAt = now;
    job.updatedAt = now;
    this.jobs.set(job.id, job);
    return clone(job);
  }

  defer(
    jobId: string,
    result: Extract<SkillRunResult, { status: "deferred" }>,
    now = this.clock.now(),
  ): ResearchJob {
    const job = this.requireJob(jobId);
    job.status = "deferred";
    job.result = clone(result);
    job.lockOwner = null;
    job.availableAt = new Date(Date.parse(now) + result.retryAfterMs).toISOString();
    job.updatedAt = now;
    this.jobs.set(job.id, job);
    return clone(job);
  }

  releaseDeferred(now = this.clock.now()): number {
    let released = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "deferred" && Date.parse(job.availableAt) <= Date.parse(now)) {
        job.status = "queued";
        job.updatedAt = now;
        this.jobs.set(job.id, job);
        released += 1;
      }
    }
    return released;
  }

  fail(
    jobId: string,
    result: Extract<SkillRunResult, { status: "failed" }>,
    now = this.clock.now(),
  ): ResearchJob {
    const job = this.requireJob(jobId);
    job.result = clone(result);
    job.lastError = result.error;
    job.lockOwner = null;
    job.updatedAt = now;

    if (result.retryable !== false && job.attempts < job.maxAttempts) {
      job.status = "queued";
      job.availableAt = new Date(Date.parse(now) + (result.retryAfterMs ?? defaultBackoffMs(job.attempts))).toISOString();
    } else {
      job.status = "failed";
      job.finishedAt = now;
    }

    this.jobs.set(job.id, job);
    return clone(job);
  }

  snapshot(): ResearchQueueSnapshot {
    return {
      schemaVersion: 1,
      jobs: [...this.jobs.values()].sort(compareJobs).map(clone),
    };
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const job of this.jobs.values()) {
      out[job.status] = (out[job.status] ?? 0) + 1;
    }
    return out;
  }

  private requireJob(jobId: string): ResearchJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown research job ${jobId}`);
    return job;
  }
}

export function jobDeterministicKey(input: ResearchJobInput): string {
  return stableStringify({
    kind: input.kind,
    payload: input.payload,
    source: input.source ?? null,
    reason: input.reason ?? null,
  });
}

export function jobIdFor(deterministicKey: string): string {
  return `rq_${createHash("sha256").update(deterministicKey).digest("hex").slice(0, 32)}`;
}

function compareJobs(a: ResearchJob, b: ResearchJob): number {
  return (
    a.priority - b.priority ||
    Date.parse(a.availableAt) - Date.parse(b.availableAt) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function defaultBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
