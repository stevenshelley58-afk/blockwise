import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiImageProvider } from "@/lib/adstudio";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import {
  TEMPLATE_CARDS_BUCKET,
  buildTemplateCardPrompt,
  templateCardObjectPath,
  type TemplateImageBrief,
} from "@/lib/adstudio/template-card-prompt";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Generate one on-brand creative per mined image brief (research.ad_template_image_briefs)
// and store it in the public template-cards bucket. Idempotent: only briefs without a
// card_image_path are processed unless ?force=1. Bounded per run so it stays under the
// function timeout; rerun (cron or manual) until `remaining` reaches 0.
type BriefRow = TemplateImageBrief & { card_image_path?: string | null };

async function assetBytes(assetUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (assetUrl.startsWith("data:image/")) {
    const decoded = dataUrlToUploadBytes(assetUrl);
    return { bytes: decoded.bytes, contentType: decoded.contentType };
  }
  if (/^https?:\/\//iu.test(assetUrl)) {
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`Could not fetch generated image (${response.status}).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return { bytes: new Uint8Array(buffer), contentType: response.headers.get("content-type") || "image/png" };
  }
  throw new Error("Image provider returned no usable asset.");
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron secret is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const only = params.get("only")?.trim();
  const limit = Math.max(1, Math.min(14, Number(params.get("limit") ?? "14") || 14));

  let research: ReturnType<typeof createSupabaseServiceClient>;
  try {
    research = createSupabaseServiceClient();
  } catch {
    return NextResponse.json({ error: "service client unavailable" }, { status: 503 });
  }

  let query = research.schema("research").from("ad_template_image_briefs").select("brief_id,name,imagery,ai_prompt_seed,card_image_path");
  if (only) query = query.eq("brief_id", only);
  else if (!force) query = query.is("card_image_path", null);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const briefs = ((data ?? []) as BriefRow[]).slice(0, limit);
  const provider = createOpenAiImageProvider();

  // Generate in parallel so a single invocation can clear the whole backlog
  // within the function timeout (sequential only managed ~1 before being cut off).
  // Each task persists independently; per-brief failures retry on the next run.
  async function generateOne(brief: BriefRow): Promise<{ ok: true; brief_id: string } | { ok: false; brief_id: string; error: string }> {
    try {
      const result = await provider.generate({
        prompt: buildTemplateCardPrompt(brief),
        referenceAssets: [],
        aspectRatio: "4:5",
        stylePreset: "photographic",
      });
      if (!result.assetUrl) throw new Error("empty asset");
      const { bytes, contentType } = await assetBytes(result.assetUrl);
      const objectPath = templateCardObjectPath(brief.brief_id);
      const upload = await research.storage
        .from(TEMPLATE_CARDS_BUCKET)
        .upload(objectPath, bytes, { contentType, upsert: true });
      if (upload.error) throw new Error(upload.error.message);
      const update = await research
        .schema("research")
        .from("ad_template_image_briefs")
        .update({ card_image_path: objectPath })
        .eq("brief_id", brief.brief_id);
      if (update.error) throw new Error(update.error.message);
      return { ok: true, brief_id: brief.brief_id };
    } catch (caught) {
      return { ok: false, brief_id: brief.brief_id, error: caught instanceof Error ? caught.message : "failed" };
    }
  }

  const results = await Promise.all(briefs.map(generateOne));
  const generated = results.filter((r) => r.ok).map((r) => r.brief_id);
  const errors = results.filter((r): r is { ok: false; brief_id: string; error: string } => !r.ok).map(({ brief_id, error }) => ({ brief_id, error }));

  const { count: remaining } = await research
    .schema("research")
    .from("ad_template_image_briefs")
    .select("brief_id", { count: "exact", head: true })
    .is("card_image_path", null);

  return NextResponse.json({ generated, errors, remaining: remaining ?? null });
}
