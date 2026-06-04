import type { AdStudioBrandKit } from "./types.ts";

export type AdStudioPersistenceStatus =
  | { status: "persisted"; warning?: never }
  | { status: "not_persisted"; warning: string };

export type AdStudioLiveResult<T> = {
  data: T;
  persistence: AdStudioPersistenceStatus;
};

const GENERATION_LOCKED_FIELDS = [
  "identity.businessName",
  "logos.primaryLogoUrl",
  "colours.primary",
  "typography.headingFont",
  "tone.voice",
  "compliance.disclaimers",
] as const;

export function approveAdStudioBrandKitForUse(brandKit: AdStudioBrandKit): AdStudioBrandKit {
  return {
    ...brandKit,
    reviewStatus: "approved",
    lockedFields: Array.from(new Set([...brandKit.lockedFields, ...GENERATION_LOCKED_FIELDS])),
  };
}

export function buildAdStudioLiveResult<T>(input: { data: T; persistenceError?: string | null }): AdStudioLiveResult<T> {
  return {
    data: input.data,
    persistence: input.persistenceError
      ? {
          status: "not_persisted",
          warning: input.persistenceError,
        }
      : {
          status: "persisted",
        },
  };
}

