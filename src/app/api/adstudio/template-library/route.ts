import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  builtInAdStudioTemplates,
  mapAdStudioLibraryTemplate,
  mergeAdStudioTemplateLibrary,
  type AdStudioLibraryTemplate,
} from "@/lib/adstudio";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { normaliseMediaUrl } from "@/lib/research/customer-meta-card.ts";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const templatePatchSchema = z.object({
  action: z.enum(["approve", "archive"]),
  templateKey: z.string().trim().min(1).max(80),
  template: z
    .object({
      name: z.string().trim().min(1).max(120),
      goal: z.string().trim().min(1).max(80),
      offerId: z.string().trim().min(1).max(80),
      promptHint: z.string().trim().min(1).max(500),
    })
    .optional(),
});

type TemplatePatchBody = z.infer<typeof templatePatchSchema>;
type ResearchClient = ReturnType<typeof researchClient>;

type ExemplarCreativeRow = {
  observed_ad_id: string | null;
  primary_image_url: string | null;
  image_storage_path: string | null;
  video_thumbnail_url: string | null;
  media_assets: unknown;
};

function isMissingTemplateLibrary(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "42P01" || /(?:v_ad_template_library|ad_template_candidates|relation .* does not exist)/i.test(error?.message ?? "");
}

function researchClient() {
  return createSupabaseServiceClient().schema("research");
}

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  let research: ReturnType<typeof researchClient>;
  try {
    research = researchClient();
  } catch {
    return NextResponse.json({ templates: builtInAdStudioTemplates(), source: "builtin_fallback" });
  }

  const { data, error } = await research
    .from("v_ad_template_library")
    .select("template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,image_brief_id,ai_prompt_seed,creative_skeleton,exemplar_observed_ad_ids,evidence_score,winner_rationale,compliance_note")
    .order("evidence_score", { ascending: false })
    .limit(100);

  if (isMissingTemplateLibrary(error)) {
    return NextResponse.json({ templates: builtInAdStudioTemplates(), source: "builtin_fallback" });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = await enrichTemplatePreviewImages(research, (data ?? []) as AdStudioLibraryTemplate[]);
  const approved = rows
    .map((row) => mapAdStudioLibraryTemplate(row))
    .filter((template) => template !== null);

  return NextResponse.json({
    templates: mergeAdStudioTemplateLibrary(approved),
    source: approved.length > 0 ? "approved_templates" : "builtin_fallback",
  });
}

export async function PATCH(request: NextRequest) {
  const parsed = templatePatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && guard.access.role !== "operator") {
    return NextResponse.json({ error: "Operator access is required." }, { status: 403 });
  }

  const body = parsed.data;
  return updateTemplateStatus(body, guard.access.userId);
}

async function updateTemplateStatus(body: TemplatePatchBody, userId: string) {
  let research: ReturnType<typeof researchClient>;
  try {
    research = researchClient();
  } catch {
    return NextResponse.json({ error: "Template library service environment is not available." }, { status: 501 });
  }

  const now = new Date().toISOString();
  const patch = body.action === "approve"
    ? { status: "approved", approved_by: userId, approved_at: now, updated_at: now }
    : { status: "archived", updated_at: now };

  const { data, error } = await research
    .from("ad_template_candidates")
    .update({
      ...patch,
    })
    .eq("template_key", body.templateKey)
    .select("template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,image_brief_id,ai_prompt_seed,creative_skeleton,exemplar_observed_ad_ids,evidence_score,winner_rationale,compliance_note")
    .maybeSingle();

  if (isMissingTemplateLibrary(error)) {
    return NextResponse.json({ error: "Template library table is not available." }, { status: 501 });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Template was not found." }, { status: 404 });

  const [row] = await enrichTemplatePreviewImages(research, [data as AdStudioLibraryTemplate]);
  const template = body.action === "approve" && row ? mapAdStudioLibraryTemplate(row) : null;
  return NextResponse.json({
    template: template ?? { id: body.templateKey, templateKey: body.templateKey, status: body.action === "approve" ? "approved" : "archived" },
  });
}

async function enrichTemplatePreviewImages(
  research: ResearchClient,
  rows: AdStudioLibraryTemplate[],
): Promise<AdStudioLibraryTemplate[]> {
  const exemplarIds = uniqueStrings(rows.flatMap((row) => row.exemplar_observed_ad_ids ?? []));
  if (exemplarIds.length === 0) return rows;

  const { data, error } = await research
    .from("ad_creatives")
    .select("observed_ad_id,primary_image_url,image_storage_path,video_thumbnail_url,media_assets")
    .in("observed_ad_id", exemplarIds);

  if (error) return rows;

  const previewByObservedAdId = new Map<string, string>();
  for (const creative of (data ?? []) as ExemplarCreativeRow[]) {
    const observedAdId = stringValue(creative.observed_ad_id);
    if (!observedAdId || previewByObservedAdId.has(observedAdId)) continue;
    const previewImageUrl = resolveTemplatePreviewImageUrl(creative);
    if (previewImageUrl) previewByObservedAdId.set(observedAdId, previewImageUrl);
  }

  return rows.map((row) => {
    const previewImageUrl = (row.exemplar_observed_ad_ids ?? [])
      .map((observedAdId) => previewByObservedAdId.get(observedAdId))
      .find((value): value is string => Boolean(value));
    return previewImageUrl ? { ...row, preview_image_url: previewImageUrl } : row;
  });
}

function resolveTemplatePreviewImageUrl(row: ExemplarCreativeRow): string | null {
  const storedImage = normaliseMediaUrl(row.image_storage_path);
  if (storedImage) return storedImage;

  if (Array.isArray(row.media_assets)) {
    for (const asset of row.media_assets) {
      if (!asset || typeof asset !== "object") continue;
      const item = asset as Record<string, unknown>;
      const kind = stringValue(item.kind) ?? stringValue(item.type) ?? stringValue(item.mediaType) ?? stringValue(item.media_type);
      if (kind?.toLowerCase() === "video") {
        const posterUrl =
          normaliseMediaUrl(item.posterStoragePath) ??
          normaliseMediaUrl(item.poster_storage_path) ??
          normaliseMediaUrl(item.thumbnailStoragePath) ??
          normaliseMediaUrl(item.thumbnail_storage_path) ??
          normaliseMediaUrl(item.posterUrl) ??
          normaliseMediaUrl(item.poster_url) ??
          normaliseMediaUrl(item.thumbnailUrl) ??
          normaliseMediaUrl(item.thumbnail_url);
        if (posterUrl) return posterUrl;
        continue;
      }
      const storagePath = stringValue(item.storagePath) ?? stringValue(item.storage_path);
      const url = normaliseMediaUrl(storagePath) ?? normaliseMediaUrl(item.url) ?? normaliseMediaUrl(item.imageUrl) ?? normaliseMediaUrl(item.image_url);
      if (url) return url;
    }
  }

  return normaliseMediaUrl(row.video_thumbnail_url) ?? normaliseMediaUrl(row.primary_image_url);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(stringValue).filter((value): value is string => Boolean(value)))];
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
