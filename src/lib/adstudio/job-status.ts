/** The durable generation-job shape returned by GET /api/adstudio/jobs/:id. */
export type AdStudioCreativeJobStatus = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  campaign_id: string | null;
};

export type AdStudioCreativeJobStatusResponse<TCampaignPack = unknown> = {
  job: AdStudioCreativeJobStatus & { campaignPack?: TCampaignPack | null };
};

/**
 * Decode the API envelope at every polling boundary. Keeping this at the
 * transport boundary prevents consumers from silently treating an envelope
 * mismatch as a non-terminal job and polling until their timeout.
 */
export function readAdStudioCreativeJobStatus<TCampaignPack = unknown>(
  payload: unknown,
): AdStudioCreativeJobStatusResponse<TCampaignPack>["job"] | null {
  if (!payload || typeof payload !== "object") return null;
  const job = (payload as { job?: unknown }).job;
  if (!job || typeof job !== "object") return null;

  const candidate = job as Partial<AdStudioCreativeJobStatus>;
  if (
    typeof candidate.id !== "string" ||
    !["queued", "running", "done", "failed"].includes(candidate.status ?? "") ||
    (candidate.error !== null && typeof candidate.error !== "string") ||
    (candidate.campaign_id !== null && typeof candidate.campaign_id !== "string")
  ) {
    return null;
  }

  return job as AdStudioCreativeJobStatusResponse<TCampaignPack>["job"];
}
