import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import {
  createImageProviderForCandidate,
  createTextProviderForCandidate,
} from "@/lib/adstudio/ai-providers";
import { resolveModelProfile, type ModelCandidate } from "@/lib/ai/model-registry";

export const runtime = "nodejs";

// Each provider probe is capped so a hung key/endpoint can't stall the whole
// health response (or the workbench that fetches it on open).
const PROVIDER_CHECK_TIMEOUT_MS = 8_000;

type ProviderHealth = {
  ok: boolean;
  error?: string;
  /** Optional note about what was actually verified (e.g. "key present"). */
  note?: string;
};

type AdStudioHealth = {
  openai: ProviderHealth;
  google: ProviderHealth;
  image: ProviderHealth;
  checkedAt: string;
};

export async function GET() {
  const operator = await requireOperator();
  if (!operator.ok) return operator.response;

  const [openai, google, image] = await Promise.all([
    checkTextProvider("openai"),
    checkTextProvider("google"),
    checkImageProvider(),
  ]);

  const body: AdStudioHealth = {
    openai,
    google,
    image,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(body);
}

/**
 * Verifies a text provider by issuing a tiny chat-completion "ping" through the
 * existing provider plumbing. Never throws — any failure (missing key, network
 * error, timeout) is reported as ok:false with a short message.
 */
async function checkTextProvider(provider: "openai" | "google"): Promise<ProviderHealth> {
  const candidate = resolveTextCandidate(provider);

  return withTimeout(async () => {
    const textProvider = createTextProviderForCandidate(candidate);
    await textProvider.generate({
      system: "ping",
      messages: [{ role: "user", content: "ping" }],
      schemaName: "metaLeadAdPack",
    });
    return { ok: true };
  }, `${provider} text check`);
}

/**
 * Image generation is expensive, so this check is deliberately lightweight: it
 * confirms the image provider constructs and that the backing API key env var
 * is present and non-empty. It reports "key present" rather than a live call.
 */
async function checkImageProvider(): Promise<ProviderHealth> {
  try {
    const candidate = resolveModelProfile("image_draft").primary;
    // Construction validates pricing/shape and throws on a malformed candidate.
    createImageProviderForCandidate(candidate);

    const envKey = candidate.provider === "google" ? "GOOGLE_AI_API_KEY" : "OPENAI_API_KEY";
    const apiKey = process.env[envKey];
    if (!apiKey || !apiKey.trim()) {
      return { ok: false, error: `${envKey} is not configured.` };
    }

    return { ok: true, note: "key present" };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Resolves a text-generation candidate for the requested provider from the
 * model registry. OpenAI uses the structured_json primary; Google has no
 * text profile whose primary is google, so we reuse the google fallback from
 * cheap_draft_text and fall back to a constructed candidate if the registry
 * shape ever changes.
 */
function resolveTextCandidate(provider: "openai" | "google"): ModelCandidate {
  if (provider === "openai") {
    return resolveModelProfile("structured_json").primary;
  }

  const googleFallback = resolveModelProfile("cheap_draft_text").fallbacks.find(
    (candidate) => candidate.provider === "google",
  );

  return (
    googleFallback ?? {
      provider: "google",
      model: "gemini-2.5-flash",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 1_000_000,
      maxLatencyMs: 8_000,
    }
  );
}

/** Races a check against a timer so a single slow provider can't hang the route. */
async function withTimeout(
  check: () => Promise<ProviderHealth>,
  label: string,
): Promise<ProviderHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      check().catch((error) => ({ ok: false as const, error: errorMessage(error) })),
      new Promise<ProviderHealth>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: `${label} timed out.` }),
          PROVIDER_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Provider check failed.";
}
