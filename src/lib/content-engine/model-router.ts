import type { ModelCandidate, ModelProfileKey } from "../ai/model-registry.ts";
import { resolveEffectiveModelProfile } from "../ai/model-registry.ts";
import { loadPersistedModelProfileVersions } from "../ai/model-profile-store.ts";

import type { ContentModelPolicy } from "./contracts.ts";

type SupabaseLike = Parameters<typeof loadPersistedModelProfileVersions>[0];

export type RoutedContentModel = {
  policy: ContentModelPolicy;
  profileKey: ModelProfileKey;
  candidate: ModelCandidate;
};

const CONTENT_MODEL_POLICY_TO_PROFILE: Record<ContentModelPolicy, ModelProfileKey> = {
  best_reasoning: "high_quality_strategy",
  best_copywriting: "high_quality_strategy",
  best_json: "structured_json",
  best_image_prompting: "high_quality_strategy",
  best_image_generation: "image_final",
  fast_low_cost: "cheap_draft_text",
  critic_review: "compliance_review",
  code_generation: "structured_json",
};

export function modelProfileForContentPolicy(policy: ContentModelPolicy): ModelProfileKey {
  return CONTENT_MODEL_POLICY_TO_PROFILE[policy];
}

export async function routeContentModel(
  supabase: SupabaseLike,
  policy: ContentModelPolicy,
): Promise<RoutedContentModel> {
  const versions = await loadPersistedModelProfileVersions(supabase);
  const profileKey = modelProfileForContentPolicy(policy);
  const resolved = resolveEffectiveModelProfile(profileKey, versions);

  if (!resolved.profile.enabled) {
    throw new Error(`Model profile ${profileKey} is disabled.`);
  }

  return {
    policy,
    profileKey,
    candidate: resolved.primary,
  };
}
