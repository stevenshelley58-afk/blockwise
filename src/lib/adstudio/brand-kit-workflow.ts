import type { AdStudioBrandKit } from "./types.ts";

// Recovered from deleted live-workflow.ts — needed by brand-kits routes
const GENERATION_LOCKED_FIELDS: string[] = [];

export function approveAdStudioBrandKitForUse(brandKit: AdStudioBrandKit): AdStudioBrandKit {
  return {
    ...brandKit,
    reviewStatus: "approved",
    lockedFields: Array.from(new Set([...brandKit.lockedFields, ...GENERATION_LOCKED_FIELDS])),
  };
}

type AdStudioLiveResult<T> = {
  data: T;
  persistence: { status: "persisted" } | { status: "not_persisted"; warning: string };
};

export function buildAdStudioLiveResult<T>(input: { data: T; persistenceError?: string | null }): AdStudioLiveResult<T> {
  return {
    data: input.data,
    persistence: input.persistenceError
      ? { status: "not_persisted", warning: input.persistenceError }
      : { status: "persisted" },
  };
}
