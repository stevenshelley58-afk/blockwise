import { z } from "zod";

import { apifyMetaAdsDatasetSchema, type ApifyMetaAd } from "../../../src/lib/research/schemas/index.ts";

/**
 * Thin Apify client tied to a single actor (the official
 * apify/facebook-ads-scraper by default) — enough surface for the
 * orchestrator without pulling the full Apify SDK.
 *
 * Cost guard: every run records its cost; the caller's daily-cap
 * accounting lives outside this client.
 */
export type RunActorInput = {
  startUrls: Array<{ url: string }>;
  resultsLimit: number;
  activeStatus?: "" | "active" | "inactive";
  isDetailsPerAd?: boolean;
};

export type ApifyRunOutcome = {
  runId: string;
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED" | "OTHER";
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
  itemCount: number;
  items: ApifyMetaAd[];
  rawDatasetId: string | null;
  errorMessage: string | null;
};

const runMetaSchema = z.object({
  data: z.object({
    id: z.string(),
    status: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable().optional(),
    usageTotalUsd: z.number().optional(),
    defaultDatasetId: z.string(),
    stats: z
      .object({
        outputDatasetItemCount: z.number().optional(),
      })
      .partial()
      .optional(),
    statusMessage: z.string().nullable().optional(),
  }),
});

export class ApifyClient {
    private readonly token: string;
  private readonly actorSlug: string;

  constructor(token: string, actorSlug: string) {
    this.token = token;
    this.actorSlug = actorSlug;
  }

  async run(input: RunActorInput, opts: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<ApifyRunOutcome> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 4_000;

    const startUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(this.actorSlug)}/runs?token=${this.token}`;
    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!startRes.ok) {
      throw new Error(`apify run start failed: ${startRes.status} ${await startRes.text()}`);
    }
    const startBody = runMetaSchema.parse(await startRes.json());
    const runId = startBody.data.id;
    const datasetId = startBody.data.defaultDatasetId;

    const start = Date.now();
    let lastMeta = startBody.data;
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const pollRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${this.token}`,
      );
      const meta = runMetaSchema.parse(await pollRes.json()).data;
      lastMeta = meta;
      if (["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(meta.status)) {
        break;
      }
    }

    const items = await this.readDatasetItems(datasetId);

    return {
      runId,
      status: normaliseStatus(lastMeta.status),
      startedAt: lastMeta.startedAt,
      finishedAt: lastMeta.finishedAt ?? null,
      costUsd: lastMeta.usageTotalUsd ?? 0,
      itemCount: lastMeta.stats?.outputDatasetItemCount ?? items.length,
      items,
      rawDatasetId: datasetId,
      errorMessage: lastMeta.statusMessage ?? null,
    };
  }

  async readDatasetItems(datasetId: string): Promise<ApifyMetaAd[]> {
    const res = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${this.token}&format=json&clean=1`,
    );
    if (!res.ok) {
      throw new Error(`apify dataset read failed: ${res.status}`);
    }
    const body = await res.json();
    return apifyMetaAdsDatasetSchema.parse(body);
  }

  /**
   * Run via run-sync-get-dataset-items — single round-trip, returns items
   * directly. Useful for short runs but has a 5-minute server-side cap.
   */
  async runSync(input: RunActorInput): Promise<ApifyMetaAd[]> {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(this.actorSlug)}/run-sync-get-dataset-items?token=${this.token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(`apify sync run failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return apifyMetaAdsDatasetSchema.parse(body);
  }
}

function normaliseStatus(s: string): ApifyRunOutcome["status"] {
  if (s === "SUCCEEDED") return "SUCCEEDED";
  if (s === "FAILED") return "FAILED";
  if (s === "TIMED-OUT" || s === "TIMED_OUT") return "TIMED_OUT";
  if (s === "ABORTED") return "ABORTED";
  return "OTHER";
}
