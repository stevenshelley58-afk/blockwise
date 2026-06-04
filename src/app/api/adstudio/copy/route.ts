import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiTextProvider, createOpenRouterTextProvider } from "@/lib/adstudio/ai-providers";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import type { TextProviderAdapter } from "@/lib/adstudio/providers";

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
    /** Brand kit voice — dominates wording style. */
    voice?: string;
    preferredPhrases?: string[];
    neverSay?: string[];
  };
};

const LIMITS: Record<keyof CopyFields, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

const SYSTEM_PROMPT = `You write Meta (Facebook/Instagram) ad copy for Australian residential real-estate lead generation. Ads run under Special Ad Category: Housing.

Hard rules:
- Never guarantee prices, returns, sale outcomes, or timeframes.
- No discriminatory or exclusionary language (age, family status, religion, ethnicity, etc.).
- Plain Australian English. Warm, useful, local — never hype or pressure.
- Respect character limits exactly: headline <= 40 chars, primaryText <= 125 chars, description <= 90 chars, cta <= 24 chars.
- The CTA is a short button label ("Book free appraisal", "Download checklist", "Get the report").

Always respond with a single JSON object:
{"headline": string, "primaryText": string, "description": string, "cta": string, "altHeadlines": [string, string], "altPrimaryTexts": [string, string]}`;

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

function buildUserMessage(body: CopyRequestBody): string {
  const context = body.context ?? {};
  const lines = [
    `Business: ${context.businessName || "a local real-estate agency"}`,
    `Campaign goal: ${context.goal || "Get appraisal leads"}`,
    `Offer: ${context.offer || "Free appraisal"}`,
    `Market: ${context.market || "the local area"}`,
    `Property type: ${context.propertyType || "Houses"}`,
  ];
  if (context.templateName) lines.push(`Template: ${context.templateName}`);
  if (context.templateHint) lines.push(`Template intent: ${context.templateHint}`);

  // Brand kit — the advertiser wrote these; they govern wording style.
  if (context.voice?.trim()) {
    lines.push("", `Write every field in this voice: ${context.voice.trim()}`);
  }
  if (context.preferredPhrases?.length) {
    lines.push(`Where natural, use phrases like: ${context.preferredPhrases.join("; ")}.`);
  }
  if (context.neverSay?.length) {
    lines.push(`Strictly never use these words or phrases: ${context.neverSay.join("; ")}.`);
  }

  if (body.mode === "brief") {
    lines.push("", "The advertiser describes the ad in their own words:", body.brief?.trim() || "(no brief provided)");
    lines.push("", "Write the full copy set from this brief.");
  } else if (body.mode === "assist") {
    lines.push("", "Current copy:", JSON.stringify(body.copy ?? {}));
    lines.push("", `Apply this single adjustment and return the full copy set: ${body.assistAction || "Improve clarity"}.`);
    lines.push("Keep fields you were not asked to change as close to the original as possible.");
  } else {
    lines.push("", "Write the full copy set for this campaign.");
  }
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<CopyRequestBody>(request);
  const provider = pickProvider();

  if (!provider) {
    return NextResponse.json(
      { error: "AI copy is not configured. Add OPENAI_API_KEY or OPENROUTER_API_KEY to enable it." },
      { status: 503 },
    );
  }

  try {
    const output = await provider.generate({
      system: SYSTEM_PROMPT,
      schemaName: "metaLeadAdPack",
      messages: [{ role: "user", content: buildUserMessage(body) }],
    });

    const json = (output.json ?? {}) as Record<string, unknown>;
    const current = body.copy ?? {};

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI copy generation failed." },
      { status: 502 },
    );
  }
}
