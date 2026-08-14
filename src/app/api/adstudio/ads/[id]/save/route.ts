import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { saveAd, SaveError } from "@/lib/adstudio/save-ad";
import { adDocumentSchema, type AdDocumentParsed } from "../../../../../../../packages/ad-template-pack-contract/src/schema.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type SaveBody = {
  document?: unknown;
  expectedRevision?: unknown;
};

/**
 * POST /api/adstudio/ads/[id]/save?workspaceId=...
 *
 * Persists a customer AdDocument as a new revision and renders Feed + Story
 * PNGs through saveAd. Returns both PNG hashes. Workspace-scoped: the ad row
 * must belong to the caller's workspace. Rejects stale revisions (409) so two
 * editors can't silently overwrite each other.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<SaveBody>(request);

  const parsed = adDocumentSchema.safeParse(body.document);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ad document: " + parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json({ error: "expectedRevision must be a non-negative integer." }, { status: 400 });
  }

  const document = parsed.data as AdDocumentParsed;

  const imageValues = await resolveImageValues(document);

  try {
    const output = await saveAd({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      adId: id,
      document,
      expectedRevision: body.expectedRevision,
      colourMap: document.resolvedColourMap,
      imageValues,
    });

    return NextResponse.json({ ad: output });
  } catch (err) {
    if (err instanceof SaveError) {
      const status =
        err.code === "ad_not_found" || err.code === "pack_not_found"
          ? 404
          : err.code === "stale_revision" || err.code === "template_hash_mismatch"
            ? 409
            : 500;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Image resolution — media URLs referenced by the document -> Buffers.
// Empty until the editor wires image upload; the renderer skips missing slots.
// ---------------------------------------------------------------------------

async function resolveImageValues(document: AdDocumentParsed): Promise<Record<string, Buffer>> {
  const entries = Object.entries(document.sharedImageValues);
  if (entries.length === 0) return {};

  const resolved: Record<string, Buffer> = {};
  for (const [key, url] of entries) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      resolved[key] = Buffer.from(await res.arrayBuffer());
    } catch {
      throw new SaveError("image_fetch_failed", `Could not fetch image for input "${key}".`);
    }
  }
  return resolved;
}
