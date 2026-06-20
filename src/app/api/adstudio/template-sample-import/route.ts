import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  extractTemplateFromImage,
  type TemplateExtractionResult,
} from "@/lib/ad-template-library/creative-dna";
import { buildSampleTemplateCandidate } from "@/lib/ad-template-library/sample-template";
import { createTextProviderForCandidate } from "@/lib/adstudio/ai-providers";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  // A media path (/api/adstudio/media?path=...), data URL, or absolute URL.
  imageUrl: z.string().trim().min(1).max(20_000),
});

export async function POST(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && guard.access.role !== "operator") {
    return NextResponse.json({ error: "Operator access is required." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const workspaceId = guard.access.workspaceId;
  const modelImage = await resolveAdStudioImageForModel(guard.supabase, workspaceId, parsed.data.imageUrl);
  if (!modelImage) {
    return NextResponse.json({ error: "Sample image could not be read for extraction." }, { status: 400 });
  }

  const imageHash = `sha256:${createHash("sha256").update(modelImage).digest("hex")}`;
  const templateKey = `sample_${createHash("sha256").update(`${workspaceId}:${imageHash}`).digest("hex").slice(0, 12)}`;

  let extraction: TemplateExtractionResult;
  try {
    extraction = await extractSampleTemplate({ imageUrl: modelImage, imageHash });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sample template extraction failed." },
      { status: 502 },
    );
  }

  const research = createSupabaseServiceClient().schema("research");
  const candidate = buildSampleTemplateCandidate({ skeleton: extraction.skeleton, templateKey });

  const { error: candidateError } = await research
    .from("ad_template_candidates")
    .upsert({ ...candidate, updated_at: new Date().toISOString() }, { onConflict: "template_key" });
  if (candidateError) {
    return NextResponse.json({ error: candidateError.message }, { status: 500 });
  }

  const { data: sampleRow, error: sampleError } = await research
    .from("template_sample_imports")
    .upsert(
      {
        workspace_id: workspaceId,
        sample_asset_url: parsed.data.imageUrl,
        image_hash: imageHash,
        extracted_json: {
          skeleton: extraction.skeleton,
          source: extraction.source,
          promptVersions: extraction.promptVersions,
        },
        status: "draft",
        candidate_template_key: templateKey,
        created_by: guard.access.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,image_hash" },
    )
    .select("id")
    .maybeSingle();
  if (sampleError) {
    return NextResponse.json({ error: sampleError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      importId: sampleRow?.id ?? null,
      templateKey,
      status: "draft",
      confidence: extraction.skeleton.confidence,
      skeleton: extraction.skeleton,
    },
    { status: 201 },
  );
}

// Runs the shared extractor over the operator's uploaded sample, trying the
// vision_extract model candidates in order until one returns a valid skeleton.
async function extractSampleTemplate(input: { imageUrl: string; imageHash: string }): Promise<TemplateExtractionResult> {
  const profile = await resolveRuntimeModelProfile("vision_extract");
  const attempts = modelCandidateAttempts(profile);
  let lastError: unknown = null;

  for (const candidate of attempts) {
    try {
      return await extractTemplateFromImage({
        asset: { imageUrl: input.imageUrl, imageHash: input.imageHash },
        source: "sample_import",
        provider: createTextProviderForCandidate(candidate, { model: candidate.model }),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No model candidate could extract the sample template.");
}
