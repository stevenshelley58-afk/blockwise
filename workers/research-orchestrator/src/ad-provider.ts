import type { NormalisedCreative } from "../../../src/lib/research/normalise.ts";
import { normaliseMetaAdLibraryAd } from "../../../src/lib/research/normalise.ts";
import {
  type MetaAdLibraryAd,
  type ObservedAdIngestInput,
  type SourceProvider,
  extractExternalAdId,
} from "../../../src/lib/research/schemas/index.ts";

import type { OrchestratorEnv } from "./env.ts";
import type { MetaProviderRunOutcome } from "./meta-provider-types.ts";
import { OfficialMetaArchiveClient } from "./official-meta-archive-client.ts";
import type { DuePage } from "./policy.ts";
import { SearchApiMetaClient } from "./searchapi-meta-client.ts";
import { SelfHostedMetaClient } from "./self-hosted-meta-client.ts";

export type AdCollectorInput = {
  page: DuePage;
  pageUrl: string;
};

export type ProviderNormaliseResult = {
  observation: ObservedAdIngestInput;
  creative: NormalisedCreative;
  payloadHash: string;
};

export type AdCollectionProvider = {
  name: string;
  sourceProvider: SourceProvider;
  confirmsAbsence: boolean;
  run(input: AdCollectorInput): Promise<MetaProviderRunOutcome>;
  normalise(ad: MetaAdLibraryAd, args: { advertiserPageId: string }): ProviderNormaliseResult;
  extractExternalAdId(ad: MetaAdLibraryAd): string;
};

export function createAdCollectionProvider(env: OrchestratorEnv): AdCollectionProvider {
  switch (env.AD_COLLECTOR_PROVIDER) {
    case "searchapi_meta":
      return new HostedMetaProvider({
        name: "searchapi_meta",
        sourceProvider: "searchapi_meta",
        confirmsAbsence: false,
        client: new SearchApiMetaClient({
          apiKey: env.SEARCHAPI_API_KEY ?? "",
          baseUrl: env.SEARCHAPI_BASE_URL,
          estimatedCostUsd: env.SEARCHAPI_ESTIMATED_COST_PER_RUN_USD,
        }),
        env,
      });
    case "official_meta_archive":
      return new HostedMetaProvider({
        name: "official_meta_archive",
        sourceProvider: "official_meta_archive",
        confirmsAbsence: false,
        client: new OfficialMetaArchiveClient({
          accessToken: env.META_AD_LIBRARY_API_TOKEN ?? "",
          graphVersion: env.META_GRAPH_VERSION,
        }),
        env,
      });
    case "self_hosted_meta":
    default:
      return new HostedMetaProvider({
        name: "self_hosted_meta",
        sourceProvider: "self_hosted_meta",
        confirmsAbsence: true,
        client: new SelfHostedMetaClient(env.SELF_HOSTED_META_COLLECTOR_URL),
        env,
      });
  }
}

class HostedMetaProvider implements AdCollectionProvider {
  readonly name: string;
  readonly sourceProvider: SourceProvider;
  readonly confirmsAbsence: boolean;
  private readonly client: { run(input: { pageId: string; country: string; resultsLimit: number; activeStatus: "active" | "inactive" | "all" }): Promise<MetaProviderRunOutcome> };
  private readonly env: OrchestratorEnv;

  constructor(args: {
    name: string;
    sourceProvider: SourceProvider;
    confirmsAbsence: boolean;
    client: HostedMetaProvider["client"];
    env: OrchestratorEnv;
  }) {
    this.name = args.name;
    this.sourceProvider = args.sourceProvider;
    this.confirmsAbsence = args.confirmsAbsence;
    this.client = args.client;
    this.env = args.env;
  }

  run(input: AdCollectorInput): Promise<MetaProviderRunOutcome> {
    return this.client.run({
      pageId: input.page.pageId,
      country: this.env.AD_COLLECTOR_COUNTRY,
      resultsLimit: this.env.AD_COLLECTOR_RESULTS_LIMIT_PER_PAGE,
      activeStatus: this.env.AD_COLLECTOR_ACTIVE_STATUS,
    });
  }

  normalise(ad: MetaAdLibraryAd, args: { advertiserPageId: string }): ProviderNormaliseResult {
    return normaliseMetaAdLibraryAd({
      ad,
      advertiserPageId: args.advertiserPageId,
      observedByProvider: this.sourceProvider,
    });
  }

  extractExternalAdId(ad: MetaAdLibraryAd): string {
    return extractExternalAdId(ad);
  }
}
