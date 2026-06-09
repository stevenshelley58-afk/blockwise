import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiTextProvider } from "@/lib/adstudio/ai-providers";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { generateBulkCell } from "@/lib/adstudio/bulk-cell";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioFormat } from "@/lib/adstudio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard ceiling: prevents runaway cost on a single request.
// Override via env var BULK_AD_MAX_CELLS (e.g., set to 50 for a power user tier).
const MAX_CELLS = Math.max(1, Number(process.env.BULK_AD_MAX_CELLS ?? "20"));

type BulkGenerateBody = {
  brandKitId?: string;
  suburbs?: string[];
  templateIds?: string[];
  formats?: string[];
  variantsPerCell?: number;
};

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const body = await readJsonBody<BulkGenerateBody>(request);
  const { brandKitId, suburbs, templateIds, formats, variantsPerCell = 1 } = body;

  if (!brandKitId || !suburbs?.length || !templateIds?.length || !formats?.length) {
    return NextResponse.json(
      { error: "brandKitId, suburbs, templateIds, and formats are required." },
      { status: 400 },
    );
  }

  const { data: bkRow, error: bkError } = await access.supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", brandKitId)
    .maybeSingle();

  if (bkError) return errorResponse(bkError);
  if (!bkRow) return NextResponse.json({ error: "Brand kit not found." }, { status: 404 });

  const brandKit = applyBrandAssetRows(
    rowToBrandKit(bkRow),
    await loadAdStudioBrandAssetRows(access.supabase, access.access.workspaceId, brandKitId),
  );

  // Fan-out: suburb × templateId × format
  type Cell = { suburb: string; templateId: string; format: AdStudioFormat };
  const allCells: Cell[] = [];
  for (const suburb of suburbs) {
    for (const templateId of templateIds) {
      for (const format of formats) {
        allCells.push({ suburb, templateId, format: format as AdStudioFormat });
      }
    }
  }

  const capped = allCells.length > MAX_CELLS;
  const cellsToRun = allCells.slice(0, MAX_CELLS);

  const visionProvider = createOpenAiTextProvider();
  // Accumulate hashes across cells so duplicates are caught run-to-run.
  const knownContentHashes: string[] = [];
  const results = [];

  for (const cell of cellsToRun) {
    const result = await generateBulkCell(access.supabase, {
      templateId: cell.templateId,
      suburb: cell.suburb,
      state: brandKit.identity.marketRegion ?? "WA",
      format: cell.format,
      brandKit,
      visionProvider,
      knownContentHashes: [...knownContentHashes],
      maxRolls: variantsPerCell,
    });

    if (!result.error && result.imageUrl) {
      knownContentHashes.push(
        createHash("sha256").update(result.imageUrl).digest("hex").slice(0, 16),
      );
    }

    results.push({
      ...result,
      suburb: cell.suburb,
      templateId: cell.templateId,
      format: cell.format,
    });
  }

  const passed = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => !!r.error).length;

  return NextResponse.json({
    summary: {
      total: cellsToRun.length,
      passed,
      failed,
      capped,
      requestedTotal: allCells.length,
    },
    cells: results,
  });
}
