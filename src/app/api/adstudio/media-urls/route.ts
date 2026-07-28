import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  ADSTUDIO_MEDIA_URL_LIMIT,
  createAdStudioMediaUrls,
} from "@/lib/adstudio/media-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
  if (
    !body ||
    !Array.isArray(body.paths) ||
    body.paths.some((path) => typeof path !== "string") ||
    body.paths.length > ADSTUDIO_MEDIA_URL_LIMIT
  ) {
    return NextResponse.json(
      { error: `paths must be an array of up to ${ADSTUDIO_MEDIA_URL_LIMIT} strings.` },
      { status: 400 },
    );
  }

  try {
    const urls = await createAdStudioMediaUrls({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      paths: body.paths as string[],
    });
    return NextResponse.json({ urls }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media URLs could not be created.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
