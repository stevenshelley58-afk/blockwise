import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  builtInAdStudioTemplates,
  mapAdStudioLibraryTemplate,
  mergeAdStudioTemplateLibrary,
  type AdStudioLibraryTemplate,
} from "@/lib/adstudio";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
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
    .select("template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,image_brief_id,sample_card_image_path,sample_style,ai_prompt_seed,creative_skeleton,exemplar_observed_ad_ids,evidence_score,winner_rationale,compliance_note")
    .order("evidence_score", { ascending: false })
    .limit(100);

  if (isMissingTemplateLibrary(error)) {
    return NextResponse.json({ templates: builtInAdStudioTemplates(), source: "builtin_fallback" });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const approved = ((data ?? []) as AdStudioLibraryTemplate[])
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
    .select("template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,image_brief_id,sample_card_image_path,sample_style,ai_prompt_seed,creative_skeleton,exemplar_observed_ad_ids,evidence_score,winner_rationale,compliance_note")
    .maybeSingle();

  if (isMissingTemplateLibrary(error)) {
    return NextResponse.json({ error: "Template library table is not available." }, { status: 501 });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Template was not found." }, { status: 404 });

  const template = body.action === "approve" ? mapAdStudioLibraryTemplate(data as AdStudioLibraryTemplate) : null;
  return NextResponse.json({
    template: template ?? { id: body.templateKey, templateKey: body.templateKey, status: body.action === "approve" ? "approved" : "archived" },
  });
}
