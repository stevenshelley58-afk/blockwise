import { normaliseHostedMetaItems } from "./hosted-meta-normalise.ts";
import type { MetaProviderRunInput, MetaProviderRunOutcome } from "./meta-provider-types.ts";

export class OfficialMetaArchiveClient {
  private readonly accessToken: string;
  private readonly graphVersion: string;

  constructor(args: { accessToken: string; graphVersion?: string }) {
    this.accessToken = args.accessToken;
    this.graphVersion = args.graphVersion ?? "v20.0";
  }

  async run(input: MetaProviderRunInput): Promise<MetaProviderRunOutcome> {
    const startedAt = new Date().toISOString();
    if (!this.accessToken) return this.failed(startedAt, "META_AD_LIBRARY_API_TOKEN is not configured");

    try {
      const params = new URLSearchParams({
        access_token: this.accessToken,
        search_page_ids: input.pageId,
        ad_reached_countries: input.country,
        ad_active_status: input.activeStatus.toUpperCase(),
        ad_type: "ALL",
        media_type: "ALL",
        limit: String(input.resultsLimit),
        fields: [
          "id",
          "page_id",
          "page_name",
          "ad_delivery_start_time",
          "ad_delivery_stop_time",
          "ad_creative_bodies",
          "ad_creative_link_captions",
          "ad_creative_link_descriptions",
          "ad_creative_link_titles",
          "ad_snapshot_url",
          "publisher_platforms",
        ].join(","),
      });
      const res = await fetch(`https://graph.facebook.com/${this.graphVersion}/ads_archive?${params}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`Official Meta archive request failed: ${res.status} ${JSON.stringify(body)}`);
      const normalised = normaliseHostedMetaItems({ body, pageId: input.pageId, limit: input.resultsLimit });
      if (normalised.warnings.length > 0) {
        return this.failed(startedAt, normalised.warnings.join("; "));
      }
      return {
        runId: `official-meta-${input.pageId}-${Date.now()}`,
        status: "SUCCEEDED",
        startedAt,
        finishedAt: new Date().toISOString(),
        costUsd: 0,
        itemCount: normalised.items.length,
        items: normalised.items,
        rawDatasetId: null,
        errorMessage: null,
        metadata: {
          provider: "official_meta_archive",
          graphVersion: this.graphVersion,
          paging: body && typeof body === "object" ? (body as Record<string, unknown>).paging ?? null : null,
        },
      };
    } catch (err) {
      return this.failed(startedAt, (err as Error).message);
    }
  }

  private failed(startedAt: string, errorMessage: string): MetaProviderRunOutcome {
    return {
      runId: `official-meta-failed-${Date.now()}`,
      status: "FAILED",
      startedAt,
      finishedAt: new Date().toISOString(),
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage,
      metadata: { provider: "official_meta_archive", graphVersion: this.graphVersion },
    };
  }
}

