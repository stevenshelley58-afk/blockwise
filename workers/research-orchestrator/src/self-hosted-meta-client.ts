import {
  metaAdLibraryDatasetSchema,
} from "../../../src/lib/research/schemas/index.ts";

import type { MetaProviderRunInput, MetaProviderRunOutcome } from "./meta-provider-types.ts";

export class SelfHostedMetaClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
  }

  async run(input: MetaProviderRunInput): Promise<MetaProviderRunOutcome> {
    const startedAt = new Date().toISOString();
    const body = await this.post("/status-check", {
      pageId: input.pageId,
      country: input.country,
      limit: input.resultsLimit,
      activeStatus: input.activeStatus,
    });

    if (body.ok !== true) {
      return this.failed(startedAt, String(body.error ?? "self-hosted collector failed"));
    }

    const parsed = metaAdLibraryDatasetSchema.safeParse(body.items ?? []);
    if (!parsed.success) {
      return this.failed(startedAt, parsed.error.issues.map((issue) => issue.message).join("; "));
    }

    return {
      runId: String(body.runId ?? `self-hosted-${input.pageId}-${Date.now()}`),
      status: "SUCCEEDED",
      startedAt,
      finishedAt: new Date().toISOString(),
      costUsd: 0,
      itemCount: parsed.data.length,
      items: parsed.data,
      rawDatasetId: null,
      errorMessage: null,
      metadata: {
        provider: "self_hosted_meta",
        collectorUrl: this.baseUrl,
        sourceUrl: body.sourceUrl ?? null,
      },
    };
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`self-hosted collector ${path} failed: ${res.status} ${JSON.stringify(body)}`);
    }
    return (body ?? {}) as Record<string, unknown>;
  }

  private failed(startedAt: string, errorMessage: string): MetaProviderRunOutcome {
    return {
      runId: `self-hosted-failed-${Date.now()}`,
      status: "FAILED",
      startedAt,
      finishedAt: new Date().toISOString(),
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage,
      metadata: { provider: "self_hosted_meta", collectorUrl: this.baseUrl },
    };
  }
}
