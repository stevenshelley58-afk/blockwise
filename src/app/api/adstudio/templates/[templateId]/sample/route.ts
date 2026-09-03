import { NextResponse, type NextRequest } from "next/server";
import { renderPlacement } from "../../../../../../../packages/ad-template-renderer/src/renderer.ts";
import type { AdTemplate } from "../../../../../../../packages/ad-template-contract/src/types.ts";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getTemplate, templateAssetStoragePath, type GallerySamplePlacement } from "@/lib/adstudio/pack-gallery";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssetRow = { asset_key: string; file_name: string; mime_type: string; storage_path: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;
  const rateLimit = await checkRateLimit(context.access.workspaceId, context.access.userId, {
    windowSeconds: 300,
    maxRequests: 30,
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

  const template = await getTemplate(context.supabase, templateId);
  if (!template) return notFoundResponse();

  try {
    const assets = await loadDeclaredAssets(template);
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
    return new NextResponse(new Uint8Array(rendered.png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Ad Studio template preview failed", { templateId, placement, error });
    return notFoundResponse();
  }
}

async function loadDeclaredAssets(template: AdTemplate): Promise<Record<string, Buffer>> {
  const service = createSupabaseServiceClient();
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
