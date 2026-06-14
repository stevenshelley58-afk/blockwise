import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { buildTemplateCreativePrompt, generateTemplateCreativeImage } from "@/lib/adstudio/creative-image";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { isBuiltInAdStudioTemplate } from "@/lib/adstudio/templates.ts";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type CreativeImageBody = {
  templateKey?: string;
  imageDataUrl?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
  aspectRatio?: string;
  brand?: { businessName?: string; primary?: string; accent?: string };
};

// The mined design recipe (ai_prompt_seed) lives server-side; fetch it by key so
// the generated creative follows the chosen template's layout and mood.
async function loadTemplateDesignSeed(templateKey: string): Promise<string | null> {
  try {
    const research = createSupabaseServiceClient().schema("research");
    const { data } = await research
      .from("v_ad_template_library")
      .select("ai_prompt_seed,description")
      .eq("template_key", templateKey)
      .maybeSingle();
    const row = data as { ai_prompt_seed?: string | null; description?: string | null } | null;
    const seed = String(row?.ai_prompt_seed ?? row?.description ?? "").trim();
    return seed || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 40,
    bucket: "ai-creative-image",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<CreativeImageBody>(request);
  const headline = body.headline?.trim();
  if (!headline) return NextResponse.json({ error: "A headline is required." }, { status: 400 });
  if (!body.imageDataUrl) return NextResponse.json({ error: "A listing photo is required." }, { status: 400 });

  try {
    const designSeed =
      body.templateKey && !isBuiltInAdStudioTemplate(body.templateKey)
        ? await loadTemplateDesignSeed(body.templateKey)
        : null;
    const referencePhoto = await resolveAdStudioImageForModel(
      context.supabase,
      context.access.workspaceId,
      body.imageDataUrl,
    );

    const prompt = buildTemplateCreativePrompt({
      designSeed: designSeed ?? undefined,
      brand: {
        businessName: body.brand?.businessName?.trim() || "Your agency",
        primary: body.brand?.primary || "#123e75",
        accent: body.brand?.accent || "#e7b24b",
      },
      copy: {
        headline,
        primaryText: body.primaryText?.trim() ?? "",
        cta: body.cta?.trim() ?? "Learn more",
      },
    });

    const generated = await generateTemplateCreativeImage({
      prompt,
      negativePrompt: "no fake text, no scrambled or misspelled letters, no watermark, no extra logos, no borders",
      referenceAssets: referencePhoto ? [referencePhoto] : [],
      aspectRatio: body.aspectRatio || "4:5",
      stylePreset: "real_estate_photography",
    });

    let image = generated.assetUrl;
    if (image.startsWith("data:image/")) {
      const decoded = dataUrlToUploadBytes(image);
      const path = `${context.access.workspaceId}/adstudio/creatives/${randomUUID()}.${decoded.extension}`;
      const { error } = await context.supabase.storage
        .from("workspace-artifacts")
        .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: false });
      if (error) throw new Error("Generated ad image could not be stored.");
      image = `/api/adstudio/media?path=${encodeURIComponent(path)}`;
    }

    return NextResponse.json({ image, model: generated.model });
  } catch (error) {
    console.error("[creative-image] generation failed", error);
    return errorResponse(error, 500);
  }
}
