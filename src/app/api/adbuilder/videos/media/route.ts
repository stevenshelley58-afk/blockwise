import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { VIDEO_BUCKET, isPathInWorkspace } from "@/lib/adbuilder/video-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authorised read of video media.
 *
 * A stored reference is this route, never a signed URL: a signed URL expires,
 * so persisting one would leave a dead reference. Authorisation is re-checked
 * on every read and only then is a short-lived link issued.
 *
 * The link is a bearer credential, so it is never logged, never cached and
 * never returned in a body the customer could share onwards in place of the
 * authenticated route.
 */

/** Short enough that a leaked link is not a durable public URL. */
const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adbuilder");
  if (!guard.ok) return guard.response;

  const { access } = guard;
  const workspaceId = access.workspaceId;

  const assetId = (request.nextUrl.searchParams.get("assetId") ?? "").trim();
  const objectPath = (request.nextUrl.searchParams.get("path") ?? "").trim();
  const download = request.nextUrl.searchParams.get("download") === "1";
  const fileName = (request.nextUrl.searchParams.get("filename") ?? "").trim().slice(0, 120);

  if (!assetId || !objectPath) {
    return NextResponse.json({ error: "A media reference is required." }, { status: 400 });
  }

  // The path must resolve into the caller's own workspace. This is checked
  // before any database or storage work, so a forged path fails immediately.
  if (!isPathInWorkspace(objectPath, workspaceId)) {
    return NextResponse.json({ error: "That media was not found." }, { status: 404 });
  }

  const limited = await checkRateLimit(workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 240,
    bucket: "video-media-read",
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const service = createSupabaseServiceClient();

  // Ownership is validated through the record, not just the identifiers: the
  // asset must belong to this workspace, carry the expected path, and be
  // customer-visible. operator-only production material never reaches here.
  const { data: asset, error } = await service
    .from("video_assets")
    .select("id, workspace_id, project_id, object_path, visibility, upload_state, mime_type, original_name, kind")
    .eq("id", assetId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !asset) {
    return NextResponse.json({ error: "That media was not found." }, { status: 404 });
  }
  if (asset.object_path !== objectPath) {
    return NextResponse.json({ error: "That media was not found." }, { status: 404 });
  }

  const operator = access.isOperator === true;
  if (asset.visibility !== "customer" && !operator) {
    return NextResponse.json({ error: "That media was not found." }, { status: 404 });
  }

  // A file that has not passed inspection, or has failed it, is quarantined.
  if (asset.upload_state !== "ready" && !operator) {
    return NextResponse.json({ error: "That media is not ready yet." }, { status: 409 });
  }

  const signed = await service.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(asset.object_path, SIGNED_URL_TTL_SECONDS, {
      download: download ? (fileName || asset.original_name || true) : false,
    });

  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ error: "That media could not be opened." }, { status: 500 });
  }

  return NextResponse.redirect(signed.data.signedUrl, {
    status: 302,
    headers: {
      // A bearer link must not be cached by a browser or an intermediary.
      "cache-control": "private, no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}
