import type { createResearchServiceClient } from "@/lib/research/service";

type ResearchServiceClient = ReturnType<typeof createResearchServiceClient>;

export const STYLE_EXTRACTOR_VERSION = "style-extractor";

// The text descriptor extracted from a radar image.
// do_not_copy is always true — the extractor enforces it regardless of model output.
export type StyleDescriptor = {
  composition: string;
  crop: string;
  lighting: string;
  time_of_day: string;
  palette: string[];
  mood: string;
  lens: string;
  do_not_copy: true;
};

export type StyleProfileResult = {
  descriptor: StyleDescriptor;
  // Always contains the input contentHash; extended by callers for multi-image sources.
  sourceContentHashes: string[];
  model: string;
};

export type PersistStyleProfileInput = {
  mediaAssetId: string;
  observedAdId: string;
  result: StyleProfileResult;
  extractorVersion?: string;
  hermesSessionId?: string;
};

type PersistStyleProfileResult = {
  profileId: string;
  decisionId: string;
  error: string | null;
};

// Write the style profile to research.ad_style_profiles and create the required
// research.agent_decisions row. Returns both IDs on success.
export async function persistStyleProfile(
  supabase: ResearchServiceClient,
  input: PersistStyleProfileInput,
): Promise<PersistStyleProfileResult> {
  const extractorVersion = input.extractorVersion ?? STYLE_EXTRACTOR_VERSION;

  // Step 1: write the agent_decisions row (Hermes rule 5: every write is a decision).
  const { data: decisionRow, error: decisionError } = await supabase
    .schema("research")
    .from("agent_decisions")
    .insert({
      decision_type: "style_profile_extraction",
      subject_type: "media_asset",
      subject_id: input.mediaAssetId,
      decision: {
        action: "extract_style_profile",
        extractor_version: extractorVersion,
        model: input.result.model,
        source_content_hashes: input.result.sourceContentHashes,
      },
      rationale: "Vision model extracted text style descriptor from radar image.",
      confidence: 80,
      evidence: { descriptor: input.result.descriptor },
      hermes_skill: extractorVersion,
      hermes_session_id: input.hermesSessionId ?? null,
      model: input.result.model,
    })
    .select("id")
    .single();

  if (decisionError || !decisionRow) {
    return {
      profileId: "",
      decisionId: "",
      error: decisionError?.message ?? "Failed to create agent_decisions row.",
    };
  }

  // Step 2: write the style profile row, linking the decision.
  const { data: profileRow, error: profileError } = await supabase
    .schema("research")
    .from("ad_style_profiles")
    .insert({
      media_asset_id: input.mediaAssetId,
      observed_ad_id: input.observedAdId,
      source_content_hashes: input.result.sourceContentHashes,
      descriptor: input.result.descriptor,
      extractor_version: extractorVersion,
      model: input.result.model,
      decision_id: decisionRow.id,
    })
    .select("id")
    .single();

  if (profileError || !profileRow) {
    return {
      profileId: "",
      decisionId: decisionRow.id,
      error: profileError?.message ?? "Failed to create ad_style_profiles row.",
    };
  }

  return {
    profileId: profileRow.id,
    decisionId: decisionRow.id,
    error: null,
  };
}
