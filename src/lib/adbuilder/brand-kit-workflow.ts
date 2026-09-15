import type { AdBuilderBrandKit } from "./types.ts";

// Recovered from deleted live-workflow.ts — needed by brand-kits routes
const GENERATION_LOCKED_FIELDS: string[] = [];

export function approveAdBuilderBrandKitForUse(brandKit: AdBuilderBrandKit): AdBuilderBrandKit {
  return {
    ...brandKit,
    reviewStatus: "approved",
    lockedFields: Array.from(new Set([...brandKit.lockedFields, ...GENERATION_LOCKED_FIELDS])),
  };
}

type AdBuilderLiveResult<T> = {
  data: T;
  persistence: { status: "persisted" } | { status: "not_persisted"; warning: string };
};

export function buildAdBuilderLiveResult<T>(input: { data: T; persistenceError?: string | null }): AdBuilderLiveResult<T> {
  return {
    data: input.data,
    persistence: input.persistenceError
      ? { status: "not_persisted", warning: input.persistenceError }
      : { status: "persisted" },
  };
}
