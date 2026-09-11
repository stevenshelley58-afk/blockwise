import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { renderPlacement } from "../../../../../../../packages/ad-template-renderer/src/renderer.ts";
import type { AdTemplate } from "../../../../../../../packages/ad-template-contract/src/types.ts";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { parseCustomerAdId } from "@/lib/adstudio/create-customer-ad";
import { getTemplate, getTemplateForExistingCustomerAd, templateAssetStoragePath, type GallerySamplePlacement } from "@/lib/adstudio/pack-gallery";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Renders are workspace-scoped, so they stay `private` (never in a shared
 * proxy cache), but a revalidating browser can hold one for an hour and
 * re-confirm it with the ETag.
 */
const SAMPLE_CACHE_CONTROL = "private, max-age=3600, stale-while-revalidate=86400";

type AssetRow = { asset_key: string; file_name: string; mime_type: string; storage_path: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;
  const rateLimit = await checkRateLimit(context.access.workspaceId, context.access.userId, {
    windowSeconds: 300,
    // The gallery renders one sample per reviewed template. A 30/5min bucket
    // was tripped by a single page view (61 templates), so 31 cards came back
    // 429 and rendered as broken images. Renders are now browser-cached, so the
    // bucket only has to stop scripted abuse, not normal browsing.
    maxRequests: 240,
    bucket: "adstudio-render",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Render limit reached. Try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const { templateId } = await params;
  const placement = parsePlacement(request.nextUrl.searchParams.get("placement"));
  if (!placement) return notFoundResponse();

  const requestedAdId = parseCustomerAdId(request.nextUrl.searchParams.get("adId") ?? undefined);
  const service = createSupabaseServiceClient();
  const activeTemplate = await getTemplate(context.supabase, templateId);
  const template = activeTemplate ?? (requestedAdId
    ? await getTemplateForExistingCustomerAd({
        customerSupabase: context.supabase,
        internalSupabase: service,
        workspaceId: context.access.workspaceId,
        adId: requestedAdId,
        templateId,
      })
    : null);
  if (!template) return notFoundResponse();

  try {
    const assets = await loadDeclaredAssets(template, service);
    const imageValues: Record<string, Buffer> = { ...assets };
    for (const input of template.imageInputs) {
      if (input.defaultAssetKey && assets[input.defaultAssetKey]) {
        imageValues[input.key] = assets[input.defaultAssetKey];
      }
    }
    const textValues = Object.fromEntries(template.textInputs.map(input => [input.key, input.placeholder]));
    const rendered = await renderPlacement({
      template,
      imageValues,
      textValues,
      colourMap: template.semanticColours,
    }, placement);
    // A gallery card renders a preview a few hundred pixels wide, so the full
    // Feed/Story render (1080x1350) is mostly wasted bytes. Downscale and
    // re-encode here, where the module already exists, rather than relying on
    // Next's optimiser: that optimiser does not forward the caller's cookies,
    // so it cannot fetch this authenticated route at all.
    const widthParam = Number(request.nextUrl.searchParams.get("w"));
    const targetWidth = Number.isFinite(widthParam) && widthParam >= 64 && widthParam <= 1080
      ? Math.round(widthParam)
      : 0;
    let body = rendered.png;
    let contentType = "image/png";
    if (targetWidth > 0) {
      const { default: sharp } = await import("sharp");
      body = await sharp(rendered.png).resize({ width: targetWidth, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer();
      contentType = "image/webp";
    }
    // A sample is a pure function of the template definition, the declared
    // assets, the placement and the requested width, so it is safe to cache
    // hard. The ETag lets a repeat view skip the body with a 304 instead of
    // re-running the canvas render.
    const etag = `"${createHash("sha256")
      .update(template.templateId)
      .update("\0")
      .update(placement)
      .update("\0")
      .update(String(targetWidth))
      .update("\0")
      .update(JSON.stringify(template))
      .digest("hex")
      .slice(0, 32)}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { etag, "cache-control": SAMPLE_CACHE_CONTROL } });
    }
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": contentType,
        etag,
        "cache-control": SAMPLE_CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("Ad Studio template preview failed", { templateId, placement, error });
    return notFoundResponse();
  }
}

async function loadDeclaredAssets(template: AdTemplate, service = createSupabaseServiceClient()): Promise<Record<string, Buffer>> {
  const declarations = Object.entries(template.assets);
  if (declarations.length === 0) return {};
  const { data, error } = await service
    .from("ad_template_assets_direct")
    .select("asset_key,file_name,mime_type,storage_path")
    .eq("template_id", template.templateId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AssetRow[];
  if (rows.length !== declarations.length) throw new Error("template assets are incomplete");
  const byKey = new Map(rows.map(row => [row.asset_key, row]));
  const values: Record<string, Buffer> = {};
  for (const [assetKey, declaration] of declarations) {
    const row = byKey.get(assetKey);
    const expectedPath = templateAssetStoragePath(template.templateId, assetKey, declaration.fileName);
    if (!row || row.file_name !== declaration.fileName || row.mime_type !== declaration.mimeType || row.storage_path !== expectedPath) {
      throw new Error(`template asset metadata mismatch: ${assetKey}`);
    }
    const { data: stored, error: downloadError } = await service.storage.from("workspace-artifacts").download(expectedPath);
    if (downloadError || !stored) throw new Error(`template asset is unavailable: ${assetKey}`);
    values[assetKey] = Buffer.from(await stored.arrayBuffer());
  }
  return values;
}

function parsePlacement(value: string | null): GallerySamplePlacement | null {
  return value === "feed" || value === "story" ? value : null;
}

function notFoundResponse() {
  return NextResponse.json({ error: "Template preview was not found." }, { status: 404 });
}
