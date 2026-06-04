import { normaliseHostedMetaItems } from "./normalise.ts";
import {
  type MetaCaptureInput,
  type MetaCaptureOutcome,
  type MetaCaptureProvider,
} from "./types.ts";

export type MetaProviderClient = {
  run(input: MetaCaptureInput): Promise<MetaCaptureOutcome>;
};

export class DisabledMetaCaptureClient implements MetaProviderClient {
  async run(input: MetaCaptureInput): Promise<MetaCaptureOutcome> {
    const now = new Date().toISOString();
    return {
      runId: `disabled-${input.metaPageId}-${Date.now()}`,
      provider: "disabled",
      status: "FAILED",
      startedAt: now,
      finishedAt: now,
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage: "HERMES_META_CAPTURE_PROVIDER is disabled",
      metadata: {
        advertiserPageId: input.advertiserPageId,
        resolverDecisionId: input.resolverDecisionId,
      },
    };
  }
}

export class HttpJsonMetaCaptureClient implements MetaProviderClient {
  constructor(
    private readonly args: {
      endpoint: string;
      timeoutMs: number;
      estimatedCostUsd: number;
      provider: MetaCaptureProvider;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(input: MetaCaptureInput): Promise<MetaCaptureOutcome> {
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.args.timeoutMs);
    try {
      const response = await this.fetchImpl(this.args.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiserPageId: input.advertiserPageId,
          metaPageId: input.metaPageId,
          country: input.country,
          activeStatus: input.activeStatus,
          resultsLimit: input.resultsLimit,
          realEstateGate: input.realEstateGate,
          resolverDecisionId: input.resolverDecisionId,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        return this.failed(startedAt, `capture endpoint failed: ${response.status} ${JSON.stringify(body)}`, input);
      }

      const normalised = normaliseHostedMetaItems({
        body,
        pageId: input.metaPageId,
        limit: input.resultsLimit,
      });
      if (normalised.warnings.length > 0) {
        return this.failed(startedAt, normalised.warnings.join("; "), input);
      }

      return {
        runId: extractRunId(body) ?? `http-json-${input.metaPageId}-${Date.now()}`,
        provider: this.args.provider,
        status: "SUCCEEDED",
        startedAt,
        finishedAt: new Date().toISOString(),
        costUsd: this.args.estimatedCostUsd,
        itemCount: normalised.items.length,
        items: normalised.items,
        rawDatasetId: extractString(body, "rawDatasetId", "datasetId"),
        errorMessage: null,
        metadata: {
          responseKeys: body && typeof body === "object" ? Object.keys(body) : [],
          advertiserPageId: input.advertiserPageId,
          resolverDecisionId: input.resolverDecisionId,
        },
      };
    } catch (err) {
      return this.failed(startedAt, (err as Error).message, input);
    } finally {
      clearTimeout(timeout);
    }
  }

  private failed(startedAt: string, errorMessage: string, input: MetaCaptureInput): MetaCaptureOutcome {
    return {
      runId: `http-json-failed-${input.metaPageId}-${Date.now()}`,
      provider: this.args.provider,
      status: "FAILED",
      startedAt,
      finishedAt: new Date().toISOString(),
      costUsd: 0,
      itemCount: 0,
      items: [],
      rawDatasetId: null,
      errorMessage,
      metadata: {
        advertiserPageId: input.advertiserPageId,
        resolverDecisionId: input.resolverDecisionId,
      },
    };
  }
}

function extractRunId(body: unknown): string | null {
  return extractString(body, "runId", "run_id", "id");
}

function extractString(body: unknown, ...keys: string[]): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}
