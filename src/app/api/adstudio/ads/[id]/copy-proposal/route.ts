import { NextResponse, type NextRequest } from "next/server";

import {
  generateAdStudioTemplateCopy,
  hasConfiguredAdStudioTextProvider,
  normalizeAdStudioAiWritingGuidance,
} from "@/lib/adstudio/copy-generation";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { adTemplateSchema } from "@/lib/adstudio/ingest-artifact";
import { toMetaCta } from "@/lib/adstudio/meta-cta";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function overlayFields(pack: Record<string, unknown>, base: Array<{ key: string; label: string; maxLength: number; sample?: string }>) {
  const defaults = pack.editorDefaults && typeof pack.editorDefaults === "object" ? pack.editorDefaults as Record<string, unknown> : null;
  const values = Array.isArray(defaults?.overlayTextInputs) ? defaults.overlayTextInputs : [];
  const existing = new Set(base.map(field => field.key));
  for (const value of values) {
    if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).key !== "string") continue;
    const item = value as Record<string, unknown>;
    if (existing.has(item.key as string)) continue;
    base.push({ key: item.key as string, label: typeof item.label === "string" ? item.label : item.key as string, maxLength: typeof item.maxLength === "number" ? item.maxLength : 120, sample: typeof item.placeholder === "string" ? item.placeholder : undefined });
  }
  return base;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const body = await readJsonBody<{ brief?: unknown }>(request);
  const brief = typeof body.brief === "string" ? body.brief : "";
  const { data: ad } = await access.supabase
    .from("ad_customer_ads")
    .select("template_id")
    .eq("id", id)
    .eq("workspace_id", access.access.workspaceId)
    .maybeSingle();
  if (!ad) return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  // Ownership was proved above. Resolve the immutable source template through
  // the internal reader so copy remains available for quarantined saved ads.
  const { data: packRow } = await createSupabaseServiceClient()
    .from("ad_templates")
    .select("template_json")
    .eq("template_id", ad.template_id)
    .maybeSingle();
  const parsed = adTemplateSchema.safeParse(packRow?.template_json);
  if (!parsed.success) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  const pack = parsed.data as unknown as import("../../../../../../../packages/ad-template-contract/src/types.ts").AdTemplate;
  const fields = overlayFields(packRow?.template_json && typeof packRow.template_json === "object" ? packRow.template_json as Record<string, unknown> : {}, pack.textInputs.map(field => ({ key: field.key, label: field.label, maxLength: field.maxLength, sample: field.placeholder })));
  const rawPack = packRow?.template_json && typeof packRow.template_json === "object" ? packRow.template_json as Record<string, unknown> : {};
  const metadata = rawPack.metadata && typeof rawPack.metadata === "object" ? rawPack.metadata as Record<string, unknown> : {};
  const guidance = normalizeAdStudioAiWritingGuidance(metadata.aiWritingGuidance);
  if (!hasConfiguredAdStudioTextProvider()) {
    return NextResponse.json(
      { error: "AI copy is temporarily unavailable because no text provider is configured." },
      { status: 503 },
    );
  }

  try {
    const brandKit = await loadLatestBrandKit(access.supabase, access.access.workspaceId);
    const brandContext = brandKit ? {
      businessName: brandKit.identity.businessName,
      market: [brandKit.identity.marketRegion, brandKit.identity.marketCountry].filter(Boolean).join(", "),
      voice: brandKit.tone.voice,
      preferredPhrases: brandKit.tone.preferredPhrases,
      neverSay: brandKit.tone.avoid,
    } : {};
    const result = await generateAdStudioTemplateCopy({
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      description: brief,
      fields,
      brandKit,
      context: {
        ...brandContext,
        goal: pack.metadata.publishRequirements.objective,
        templateName: pack.metadata.title,
        templateHint: pack.metadata.aiWritingGuidance.summary,
        aiWritingGuidance: guidance,
      },
    });
    return NextResponse.json({ ...result, copy: { ...result.copy, cta: toMetaCta(result.copy.cta) } });
  } catch (error) {
    return errorResponse(error, 502);
  }
}

async function loadLatestBrandKit(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<AdStudioBrandKit | null> {
  const { data, error } = await supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("Ad Studio copy Brand Pack load failed", {
      workspaceId,
      reason: error.message,
    });
    throw new Error("Brand Pack could not be loaded.");
  }
  const row = (data ?? []).find(candidate => !isExampleBrandKitSourceUrl(String(candidate.source_url ?? "")));
  return row ? rowToBrandKit(row as Record<string, unknown>) : null;
}
