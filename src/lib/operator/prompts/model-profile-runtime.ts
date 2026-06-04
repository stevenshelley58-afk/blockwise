import { loadPersistedModelProfileVersions } from "../../ai/model-profile-store.ts";
import type { ModelCandidate, ModelProfileKey, ResolvedModelProfile } from "../../ai/model-registry.ts";
import { resolveEffectiveModelProfile, resolveModelProfile } from "../../ai/model-registry.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";

export type RuntimeModelProfile = ResolvedModelProfile & {
  source: "persisted" | "default";
  warning?: string;
};

export async function resolveRuntimeModelProfile(profileKey: ModelProfileKey): Promise<RuntimeModelProfile> {
  try {
    const serviceSupabase = createSupabaseServiceClient();
    const versions = await loadPersistedModelProfileVersions(serviceSupabase as never);
    return {
      ...resolveEffectiveModelProfile(profileKey, versions),
      source: "persisted",
    };
  } catch (error) {
    return {
      ...resolveModelProfile(profileKey),
      source: "default",
      warning: error instanceof Error ? error.message : "Unable to load persisted model profile.",
    };
  }
}

export function modelCandidateAttempts(profile: RuntimeModelProfile): ModelCandidate[] {
  return [profile.primary, ...profile.fallbacks];
}
