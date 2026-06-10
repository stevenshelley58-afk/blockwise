import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TextProviderAdapter } from "./providers.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const STYLE_EXTRACTOR_VERSION = "style-extractor-v1";

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

export type ExtractStyleProfileInput = {
  // Temporary signed/public URL for the vision model.
  // This URL is NEVER stored; only the content hash is kept.
  imageUrl: string;
  // SHA/MD5 hash of the image bytes — stored for cache hits and the similarity guard.
  contentHash: string;
  provider: TextProviderAdapter;
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

const SYSTEM_PROMPT = `You are a visual style analyst for a real estate ad creative studio.
You are shown a real estate advertisement image.
Extract the VISUAL STYLE LANGUAGE — not the content — of the image.
Return ONLY compact JSON with exactly these fields:
{
  "composition": "brief description of how the subject is framed and where elements sit",
  "crop": "tight | medium | wide | aerial | detail",
  "lighting": "brief description of light quality, direction, and hardness",
  "time_of_day": "morning | midday | afternoon | golden_hour | dusk | overcast",
  "palette": ["up to 4 dominant hex codes or plain colour names"],
  "mood": "brief description of the emotional tone or atmosphere",
  "lens": "wide | standard | telephoto | fisheye | drone",
  "do_not_copy": true
}
Rules:
- "do_not_copy" MUST be the literal boolean true.
- Do NOT include brand names, agent names, phone numbers, addresses, prices, or any identifiable text.
- Do NOT reproduce image content or describe the specific property.
- Describe STYLE only: framing, light, palette, mood, lens character.
- Output JSON only — no markdown, no prose outside the object.`;

export async function extractStyleProfile(
  input: ExtractStyleProfileInput,
): Promise<StyleProfileResult> {
  const response = await input.provider.generate({
    system: SYSTEM_PROMPT,
    // schemaName is required by TextProviderRequest; response JSON is parsed manually below.
    schemaName: "metaLeadAdPack",
    imageUrl: input.imageUrl,
    messages: [
      {
        role: "user",
        content:
          "Extract the visual style descriptor from this real estate ad image. Return compact JSON only.",
      },
    ],
  });

  const raw =
    response.json && typeof response.json === "object"
      ? (response.json as Record<string, unknown>)
      : {};
  const model =
    typeof response.providerMetadata?.model === "string"
      ? response.providerMetadata.model
      : "unknown";

  return {
    descriptor: coerceDescriptor(raw),
    sourceContentHashes: [input.contentHash],
    model,
  };
}

// Write the style profile to research.ad_style_profiles and create the required
// research.agent_decisions row. Returns both IDs on success.
export async function persistStyleProfile(
  supabase: SupabaseServerClient,
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

function coerceDescriptor(raw: Record<string, unknown>): StyleDescriptor {
  return {
    composition: stringify(raw.composition),
    crop: stringify(raw.crop),
    lighting: stringify(raw.lighting),
    time_of_day: stringify(raw.time_of_day),
    palette: Array.isArray(raw.palette) ? raw.palette.map(stringify) : [],
    mood: stringify(raw.mood),
    lens: stringify(raw.lens),
    // Always enforce do_not_copy=true regardless of what the model returned.
    do_not_copy: true,
  };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}
