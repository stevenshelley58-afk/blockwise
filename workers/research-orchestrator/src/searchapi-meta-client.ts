import { normaliseHostedMetaItems } from "./hosted-meta-normalise.ts";
import type { MetaProviderRunInput, MetaProviderRunOutcome } from "./meta-provider-types.ts";

export class SearchApiMetaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly estimatedCostUsd: number;

  constructor(args: { apiKey: string; baseUrl?: string; estimatedCostUsd?: number }) {
    this.apiKey = args.apiKey;
    this.baseUrl = (args.baseUrl ?? "https://www.searchapi.io/api/v1/search").replace(/\/$/u, "");
    this.estimatedCostUsd = args.estimatedCostUsd ?? 0;
  }

  async run(input: MetaProviderRunInput): Promise<MetaProviderRunOutcome> {
    const startedAt = new Date().toISOString();
    if (!this.apiKey) return this.failed(startedAt, "SEARCHAPI_API_KEY is not configured");

    try {
      const body = await this.post({
        engine: "meta_ad_library",
        page_id: input.pageId,
        country: input.country,
        ad_type: "all",
        active_status: input.activeStatus,
        media_type: "all",
      });
      const normalised = normaliseHostedMetaItems({ body, pageId: input.pageId, limit: input.resultsLimit });
      if (normalised.warnings.length > 0) {
        return this.failed(startedAt, normalised.warnings.join("; "));
      }
      return {
        runId: `searchapi-${input.pageId}-${Date.now()}`,
        status: "SUCCEEDED",
        startedAt,
        finishedAt: new Date().toISOString(),
        costUsd: this.estimatedCostUsd,
        itemCount: normalised.items.length,
        items: normalised.items,
        rawDatasetId: null,
        errorMessage: null,
        metadata: {
          provider: "searchapi_meta",
          responseKeys: body && typeof body === "object" ? Object.keys(body) : [],
        },
      };
    } catch (err) {
      return this.failed(startedAt, (err as Error).message);
    }
  }

  private async post(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`SearchAPI Meta request failed: ${res.status} ${JSON.stringify(body)}`);
    return (body ?? {}) as Record<string, unknown>;
  }

  private failed(startedAt: string, errorMessage: string): MetaProviderRunOutcome {
    return {
      runId: `searchapi-failed-${Date.now()}`,
      status: "FAILED",
      startedAt,
      finishedAt: new Date().toISOString(),
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage,
      metadata: { provider: "searchapi_meta" },
    };
  }
}

