import { loadPersistedModelProfileVersions } from "../../ai/model-profile-store.ts";
import type {
  ModelCandidate,
  ModelProfileKey,
  PersistedModelProfileVersion,
  ResolvedModelProfile,
} from "../../ai/model-registry.ts";
import { resolveEffectiveModelProfile } from "../../ai/model-registry.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";

export type RuntimeModelProfile = ResolvedModelProfile & {
  source: "persisted" | "default";
  warning?: string;
};

export async function resolveRuntimeModelProfile(profileKey: ModelProfileKey): Promise<RuntimeModelProfile> {
  const serviceSupabase = createSupabaseServiceClient();
  const versions = await loadPersistedModelProfileVersions(serviceSupabase as never);
  return resolveRuntimeProfileFromVersions(profileKey, versions);
}

export function resolveRuntimeProfileFromVersions(
  profileKey: ModelProfileKey,
  versions: PersistedModelProfileVersion[],
): RuntimeModelProfile {
  const hasPersistedVersion = versions.some((version) => version.profileKey === profileKey);
  return {
    ...resolveEffectiveModelProfile(profileKey, versions),
    source: hasPersistedVersion ? "persisted" : "default",
    ...(!hasPersistedVersion ? { warning: `No active persisted version exists for ${profileKey}; using the declared default.` } : {}),
  };
}

export function modelCandidateAttempts(profile: RuntimeModelProfile): ModelCandidate[] {
  return [profile.primary, ...profile.fallbacks];
}
