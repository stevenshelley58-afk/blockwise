import { NextResponse, type NextRequest } from "next/server";

import { adDocumentSchema } from "../../../../../../../packages/ad-template-contract/src/schema.ts";
import { requireAdBuilderRequest } from "@/lib/adbuilder/http";
import {
  adCopyFileName,
  buildAdCopySheet,
  resolveExportTimeZone,
} from "@/lib/adbuilder/download-pack";
import { parseCustomerAdId } from "@/lib/adbuilder/create-customer-ad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

// ---------------------------------------------------------------------------
// Ad copy export.
//
// This is the "run it yourself" half of the no-card download pack. It is
// deliberately reachable with workspace access alone: no card, no subscription,
// no Meta connection. Artwork is served by the existing media route, which
// already enforces the same workspace scope.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireAdBuilderRequest(request);
  if (!access.ok) return access.response;

  const adId = parseCustomerAdId((await Promise.resolve(context.params)).id);
  if (!adId) {
    return NextResponse.json({ error: "Ad not found.", code: "ad_not_found" }, { status: 404 });
  }

  const { data: ad, error: adError } = await access.supabase
    .from("ad_customer_ads")
    .select("name, active_revision_id, meta_primary_text, meta_headline, meta_description, meta_cta")
    .eq("id", adId)
    .eq("workspace_id", access.access.workspaceId)
    .maybeSingle();

  if (adError) {
    return NextResponse.json({ error: "The ad could not be loaded.", code: "ad_load_failed" }, { status: 500 });
  }
  if (!ad) {
    return NextResponse.json({ error: "Ad not found.", code: "ad_not_found" }, { status: 404 });
  }

  const row = ad as {
    name?: string | null;
    active_revision_id?: string | null;
    meta_primary_text?: string | null;
    meta_headline?: string | null;
    meta_description?: string | null;
    meta_cta?: string | null;
  };

  // The pack describes finished artwork. Until the customer saves, there is no
  // pack to hand over, so say so plainly instead of exporting an empty sheet.
  if (!row.active_revision_id) {
    return NextResponse.json(
      { error: "Save your ad before downloading it.", code: "ad_not_saved" },
      { status: 404 },
    );
  }

  const { data: revision, error: revisionError } = await access.supabase
    .from("ad_revisions")
    .select("feed_png_path, story_png_path, document_json")
    .eq("id", row.active_revision_id)
    .eq("workspace_id", access.access.workspaceId)
    .maybeSingle();

  if (revisionError || !revision) {
    return NextResponse.json(
      { error: "Save your ad before downloading it.", code: "ad_not_saved" },
      { status: 404 },
    );
  }

  const revisionRow = revision as {
    feed_png_path?: unknown;
    story_png_path?: unknown;
    document_json?: unknown;
  };
  const adName = (row.name ?? "").trim() || "Untitled ad";
  const parsedDocument = adDocumentSchema.safeParse(revisionRow.document_json);

  const sheet = buildAdCopySheet({
    adName,
    metaPrimaryText: row.meta_primary_text ?? "",
    metaHeadline: row.meta_headline ?? "",
    metaDescription: row.meta_description ?? "",
    metaCta: row.meta_cta ?? "",
    destinationUrl: parsedDocument.success ? parsedDocument.data.destinationUrl ?? null : null,
    hasFeedArtwork: typeof revisionRow.feed_png_path === "string" && Boolean(revisionRow.feed_png_path),
    hasStoryArtwork: typeof revisionRow.story_png_path === "string" && Boolean(revisionRow.story_png_path),
    exportedAt: new Date(),
    timeZone: resolveExportTimeZone(process.env.BLOCKWISE_EXPORT_TIMEZONE),
  });

  return new NextResponse(sheet, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${adCopyFileName(adName)}"`,
      "cache-control": "private, no-store",
    },
  });
}
