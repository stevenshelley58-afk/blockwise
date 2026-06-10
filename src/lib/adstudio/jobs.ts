import { createHash } from "node:crypto";

export type AdStudioJobStatus = "queued" | "running" | "succeeded" | "failed";

export type AdStudioJobRun = {
  jobId: string;
  workspaceId: string;
  jobType:
    | "brand.extract.website"
    | "brand.capture.screenshots"
    | "brand.analyse.visuals"
    | "brand.extract.assets"
    | "campaign.generate.strategy"
    | "campaign.generate.copy"
    | "creative.generate.backgrounds"
    | "creative.generate.layouts"
    | "creative.render.exports"
    | "compliance.check.campaign"
    | "compliance.check.creative"
    | "export.package.create"
    | "publish.meta.prepare"
    | "publish.google.prepare";
  status: AdStudioJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  inputHash: string;
  outputRefs: string[];
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
};

// Stub: job persistence not yet implemented. These functions build in-memory job
// run objects only; they are never written to the database.
export function createAdStudioJobRun(input: {
  workspaceId: string;
  jobType: AdStudioJobRun["jobType"];
  payload: unknown;
  status?: AdStudioJobStatus;
}): AdStudioJobRun {
  const inputHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");

  return {
    jobId: `adjob_${inputHash.slice(0, 12)}`,
    workspaceId: input.workspaceId,
    jobType: input.jobType,
    status: input.status ?? "queued",
    startedAt: null,
    finishedAt: null,
    inputHash,
    outputRefs: [],
    error: null,
  };
}

export function failAdStudioJobRun(
  job: AdStudioJobRun,
  error: { code: string; message: string; retryable: boolean },
): AdStudioJobRun {
  return {
    ...job,
    status: "failed",
    finishedAt: new Date().toISOString(),
    error,
  };
}
