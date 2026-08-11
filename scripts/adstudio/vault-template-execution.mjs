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
