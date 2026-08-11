import { createSupabaseServiceClient } from "../../src/lib/supabase/service.ts";
import { resolveSupabaseServerCredential } from "../../src/lib/supabase/credentials.ts";
import { loadRuntimeProviderToken } from "../../src/lib/providers/provider-connections.ts";

/**
 * Template packet execution is an explicit VPS operation. The marker prevents
 * a developer shell or Vercel function from silently gaining access merely
 * because it happens to have some Supabase variables configured.
 */
export function assertVpsTemplateExecutionContext(env = process.env) {
  if (env.BLOCKWISE_TEMPLATE_EXECUTION_CONTEXT !== "vps" || env.VERCEL) {
    throw new Error("Vault-backed template rendering is allowed only in the explicit VPS execution context.");
  }
  if (!resolveSupabaseServerCredential(env)) {
    throw new Error("Vault-backed template rendering requires a Supabase service-role credential.");
  }
  if (!env.TOKEN_ENCRYPTION_KEY?.trim()) {
    throw new Error("Vault-backed template rendering requires TOKEN_ENCRYPTION_KEY.");
  }
}

/** Load the Google key into one short-lived provider environment in memory. */
export async function loadVaultGoogleProviderEnvironment(input = {}) {
  const env = input.env ?? process.env;
  const createServiceClient = input.createServiceClient ?? createSupabaseServiceClient;
  const loadToken = input.loadToken ?? loadRuntimeProviderToken;
  assertVpsTemplateExecutionContext(env);
  const serviceSupabase = createServiceClient({ env });
  const googleAiApiKey = await loadToken(serviceSupabase, "google");
  if (!googleAiApiKey) {
    throw new Error("The encrypted Google runtime credential is not provisioned.");
  }
  return Object.freeze({ GOOGLE_AI_API_KEY: googleAiApiKey });
}

/** Rehydrate only the immutable provider request fields locked at export. */
export function lockedPacketImageRequest(packet, referenceAssets) {
  if (!Array.isArray(referenceAssets) || referenceAssets.length !== packet.references?.length) {
    throw new Error("Locked packet reference assets do not match the exported reference order.");
  }
  return {
    prompt: packet.prompt,
    negativePrompt: packet.negativePrompt || undefined,
    referenceAssets: [...referenceAssets],
    aspectRatio: packet.aspectRatio,
    stylePreset: "real_estate_clone",
    seed: packet.seed,
    requiresReferenceAssets: true,
  };
}

/**
 * Select a priced image-final candidate without allowing a caller to alter the
 * locked clone packet. Candidate order is the production profile order:
 * primary first, then declared fallbacks.
 */
export function resolvePricedGoogleImageFinalCandidate(profile, candidateIndex = 0) {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
    throw new Error("--candidate-index must be a non-negative integer.");
  }
  const candidates = [profile.primary, ...profile.fallbacks]
    .filter((candidate) => Number.isFinite(candidate.imageUsdPerUnit) && candidate.imageUsdPerUnit > 0);
  const selected = candidates[candidateIndex];
  if (!selected) {
    throw new Error(`--candidate-index ${candidateIndex} is outside the priced image_final candidate list.`);
  }
  if (selected.provider !== "google") {
    throw new Error(`--candidate-index ${candidateIndex} selects ${selected.provider}; render-request-vault only supports Google candidates.`);
  }
  return Object.freeze({ candidateIndex, candidate: selected });
}
