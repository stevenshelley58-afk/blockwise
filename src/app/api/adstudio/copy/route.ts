import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  createOpenAiTextProvider,
  createOpenRouterTextProvider,
  createTextProviderForCandidate,
} from "@/lib/adstudio/ai-providers";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import type { TextProviderAdapter, TextProviderResponse } from "@/lib/adstudio/providers";
import { assembleMetaCopyPrompt } from "@/lib/operator/prompts/assemble-prompt";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { getActivePromptBundle, type PromptKey } from "@/lib/operator/prompts/prompt-registry";
import { recordAdStudioProviderRun } from "@/lib/operator/prompts/redact-prompt-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CopyFields = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

type CopyRequestBody = {
  mode?: "generate" | "brief" | "assist";
  brief?: string;
  assistAction?: string;
  copy?: Partial<CopyFields>;
  context?: {
    goal?: string;
    offer?: string;
    market?: string;
    propertyType?: string;
    businessName?: string;
    templateName?: string;
    templateHint?: string;
    /** Brand kit voice - dominates wording style. */
    voice?: string;
    preferredPhrases?: string[];
    neverSay?: string[];
  };
};

type CopyGenerationResult = {
  output: TextProviderResponse;
  provider: TextProviderAdapter;
  modelName: string;
  attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
};

const COPY_PROMPT_KEYS: PromptKey[] = [
  "adstudio.copy.system",
  "adstudio.copy.input_template",
  "adstudio.copy.output_schema",
  "adstudio.copy.compliance_rules",
];

const LIMITS: Record<keyof CopyFields, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

function pickProvider(): TextProviderAdapter | null {
  if (process.env.OPENAI_API_KEY) return createOpenAiTextProvider();
  if (process.env.OPENROUTER_API_KEY) return createOpenRouterTextProvider();
  return null;
}

function clamp(value: unknown, limit: number, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length > limit ? text.slice(0, limit).trimEnd() : text;
}

function clampList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 2)
    .map((item) => (item.length > limit ? item.slice(0, limit).trimEnd() : item.trim()));
}

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<CopyRequestBody>(request);
  const startedAt = Date.now();
  const correlationId = randomUUID();
  const bundle = await getActivePromptBundle(COPY_PROMPT_KEYS);
  const assembled = assembleMetaCopyPrompt({
    bundle,
    mode: body.mode ?? "generate",
    context: body.context ?? {},
    brief: body.brief,
    currentCopy: body.copy,
    assistAction: body.assistAction,
  });
  let generation: CopyGenerationResult | null = null;

  try {
    generation = await generateCopyWithProfile(assembled.system, assembled.user);
    const output = generation.output;
    const json = (output.json ?? {}) as Record<string, unknown>;
    const current = body.copy ?? {};

    await recordAdStudioProviderRun({
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      correlationId,
      taskType: "adstudio.copy",
      modelProfile: "structured_json",
      prompt: assembled,
      input: {
        mode: body.mode ?? "generate",
        context: body.context ?? {},
        brief: body.brief,
        copy: body.copy,
        assistAction: body.assistAction,
      },
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.provider.providerName,
      providerType: generation.provider.providerType,
      modelName: generation.modelName,
      output,
      status: "completed",
    });

    return NextResponse.json({
      copy: {
        headline: clamp(json.headline, LIMITS.headline, current.headline ?? ""),
        primaryText: clamp(json.primaryText, LIMITS.primaryText, current.primaryText ?? ""),
        description: clamp(json.description, LIMITS.description, current.description ?? ""),
        cta: clamp(json.cta, LIMITS.cta, current.cta ?? "Learn more"),
      },
      alternates: {
        headline: clampList(json.altHeadlines, LIMITS.headline),
        primaryText: clampList(json.altPrimaryTexts, LIMITS.primaryText),
      },
      source: "ai" as const,
    });
  } catch (error) {
    await recordAdStudioProviderRun({
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      correlationId,
      taskType: "adstudio.copy",
      modelProfile: "structured_json",
      prompt: assembled,
      input: {
        mode: body.mode ?? "generate",
        context: body.context ?? {},
        brief: body.brief,
        copy: body.copy,
        assistAction: body.assistAction,
      },
      attempts: generation?.attempts ?? [],
      latencyMs: Date.now() - startedAt,
      providerName: generation?.provider.providerName ?? "unavailable",
      providerType: "text_generation",
      modelName: generation?.modelName ?? "unavailable",
      output: null,
      status: "failed",
      error,
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI copy generation failed." },
      { status: 502 },
    );
  }
}

async function generateCopyWithProfile(system: string, user: string): Promise<CopyGenerationResult> {
  const profile = await resolveRuntimeModelProfile("structured_json");
  const attempts: CopyGenerationResult["attempts"] = [];
  let lastError: unknown = null;

  for (const candidate of modelCandidateAttempts(profile)) {
    const provider = createTextProviderForCandidate(candidate);
    attempts.push({ provider: provider.providerName, model: candidate.model, status: "attempted" });

    try {
      const output = await provider.generate({
        system,
        schemaName: "metaLeadAdPack",
        messages: [{ role: "user", content: user }],
      });
      attempts[attempts.length - 1] = { provider: provider.providerName, model: candidate.model, status: "completed" };
      return {
        output,
        provider,
        modelName: String(output.providerMetadata.model ?? candidate.model),
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: provider.providerName,
        model: candidate.model,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const legacyProvider = pickProvider();

  if (legacyProvider) {
    attempts.push({ provider: legacyProvider.providerName, model: "env_default", status: "attempted" });
    try {
      const output = await legacyProvider.generate({
        system,
        schemaName: "metaLeadAdPack",
        messages: [{ role: "user", content: user }],
      });
      attempts[attempts.length - 1] = { provider: legacyProvider.providerName, model: "env_default", status: "completed" };
      return {
        output,
        provider: legacyProvider,
        modelName: String(output.providerMetadata.model ?? "env_default"),
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: legacyProvider.providerName,
        model: "env_default",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("AI copy is not configured. Add OPENAI_API_KEY or OPENROUTER_API_KEY to enable it.");
}
