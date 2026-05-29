import type { MetaAdLibraryAd } from "../../../src/lib/research/schemas/index.ts";

export type MetaProviderRunInput = {
  pageId: string;
  country: string;
  resultsLimit: number;
  activeStatus: "active" | "inactive" | "all";
};

export type MetaProviderRunOutcome = {
  runId: string;
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED" | "OTHER";
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
  itemCount: number;
  items: MetaAdLibraryAd[];
  rawDatasetId: string | null;
  errorMessage: string | null;
  metadata?: Record<string, unknown>;
};

