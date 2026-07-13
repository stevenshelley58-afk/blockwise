import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { fetchOpenRouterModelCatalog } from "./openrouter-client.ts";
import { hasOperatorAccessFromRows } from "../auth/workspace-access.ts";
import {
  type EnvLike,
  buildModelControlViewData,
  buildModelProfileVersionInsert,
  optionToCandidate,
  validateModelProfileSelection,
} from "./model-control-config.ts";
import type { ModelControlViewData } from "./model-control-config.ts";
import type { ModelProfileKey, ModelProvider, PersistedModelProfileVersion } from "./model-registry.ts";
import { resolveEffectiveModelProfiles } from "./model-registry.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ModelProfileVersionRow = {
  id: string;
  provider: string;
  model: string;
  input_usd_per_million_tokens: number | string;
  output_usd_per_million_tokens: number | string;
  image_usd_per_unit: number | string;
  supports_structured_output: boolean;
  max_context_tokens: number;
  model_profiles: { key: string } | { key: string }[] | null;
};

type SaveModelProfileSelectionResult =
  | {
      ok: true;
      profileKey: ModelProfileKey;
      active: ReturnType<typeof optionToCandidate>;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

const DEFAULT_MAX_LATENCY_MS = 12_000;

export async function getModelControlViewData(
  supabase: SupabaseServerClient,
): Promise<ModelControlViewData> {
  const versions = await loadPersistedModelProfileVersions(supabase);
  const profiles = resolveEffectiveModelProfiles(versions).filter((profile) => profile.key !== "disabled_profile");
  const env = process.env as EnvLike;
  const catalogOptions = env.OPENROUTER_API_KEY ? await fetchOpenRouterModelCatalog({ env }).catch(() => []) : [];

  return buildModelControlViewData({ profiles, env, catalogOptions });
}

export async function loadPersistedModelProfileVersions(
  supabase: SupabaseServerClient,
): Promise<PersistedModelProfileVersion[]> {
  const { data, error } = await supabase
    .from("model_profile_versions")
    .select(
      "id, provider, model, input_usd_per_million_tokens, output_usd_per_million_tokens, image_usd_per_unit, supports_structured_output, max_context_tokens, model_profiles!inner(key)",
    )
    .is("active_to", null)
    .order("active_from", { ascending: false });

  if (error) {
    throw new Error(`Unable to load active model profile versions: ${error.message}`);
  }
  if (!data) {
    throw new Error("Unable to load active model profile versions: query returned no data.");
  }

  return (data as ModelProfileVersionRow[]).flatMap((row) => {
    const profileKey = getJoinedProfileKey(row.model_profiles);

    if (!profileKey) {
      return [];
    }

    const provider = parsePersistedProvider(row.provider);
    const inputPrice = parsePersistedPrice(row.input_usd_per_million_tokens, "input token price", row.id);
    const outputPrice = parsePersistedPrice(row.output_usd_per_million_tokens, "output token price", row.id);
    const imagePrice = parsePersistedPrice(row.image_usd_per_unit, "image unit price", row.id);

    if (!row.id || !row.model.trim()) {
      throw new Error("Active model profile version is missing its version id or model slug.");
    }

    return [
      {
        id: row.id,
        profileKey,
        provider,
        model: row.model,
        inputUsdPerMillionTokens: inputPrice,
        outputUsdPerMillionTokens: outputPrice,
        imageUsdPerUnit: imagePrice,
        supportsStructuredOutput: row.supports_structured_output,
        maxContextTokens: row.max_context_tokens,
        maxLatencyMs: DEFAULT_MAX_LATENCY_MS,
      },
    ];
  });
}

function parsePersistedProvider(value: string): ModelProvider {
  if (["openai", "openrouter", "azure", "google", "fal"].includes(value)) {
    return value as ModelProvider;
  }
  throw new Error(`Active model profile version has unsupported provider: ${value || "(empty)"}.`);
}

function parsePersistedPrice(value: number | string, label: string, versionId: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Active model profile version ${versionId || "(unknown)"} has invalid ${label}.`);
  }
  return parsed;
}

export async function saveModelProfileSelection(
  supabase: SupabaseServerClient,
  profileKeyValue: string,
  request: { provider?: unknown; model?: unknown },
): Promise<SaveModelProfileSelectionResult> {
  const validation = validateModelProfileSelection(profileKeyValue, request);

  if (!validation.ok) {
    return validation;
  }

  const { data: modelProfile, error: profileError } = await supabase
    .from("model_profiles")
    .select("id")
    .eq("key", profileKeyValue)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: "Unable to load model profile.",
    };
  }

  if (!modelProfile?.id) {
    return {
      ok: false,
      status: 404,
      error: `Unknown model profile: ${profileKeyValue}`,
    };
  }

  const activeTo = new Date().toISOString();
  const { error: closeError } = await supabase
    .from("model_profile_versions")
    .update({ active_to: activeTo })
    .eq("model_profile_id", modelProfile.id)
    .is("active_to", null);

  if (closeError) {
    return {
      ok: false,
      status: 500,
      error: "Unable to close the previous model version.",
    };
  }

  const { error: insertError } = await supabase
    .from("model_profile_versions")
    .insert({
      ...buildModelProfileVersionInsert(modelProfile.id, validation.option),
      active_from: activeTo,
    });

  if (insertError) {
    return {
      ok: false,
      status: 500,
      error: "Unable to save model profile version.",
    };
  }

  return {
    ok: true,
    profileKey: profileKeyValue as ModelProfileKey,
    active: optionToCandidate(validation.option),
  };
}

export async function ensureOperatorSession(
  supabase: SupabaseServerClient,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Authentication is required.",
    };
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_operator")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("workspace_members")
      .select("role")
      .eq("profile_id", user.id),
  ]);

  if (!hasOperatorAccessFromRows(profile, memberships)) {
    return {
      ok: false,
      status: 403,
      error: "Operator access is required.",
    };
  }

  return { ok: true };
}

function getJoinedProfileKey(value: ModelProfileVersionRow["model_profiles"]): ModelProfileKey | null {
  const joined = Array.isArray(value) ? value[0] : value;
  const key = joined?.key;

  switch (key) {
    case "cheap_draft_text":
    case "high_quality_strategy":
    case "structured_json":
    case "vision_classification":
    case "image_draft":
    case "image_final":
    case "image_generative":
    case "compliance_review":
    case "disabled_profile":
      return key;
    default:
      return null;
  }
}
