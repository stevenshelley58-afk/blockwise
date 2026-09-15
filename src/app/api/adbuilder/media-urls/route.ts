import { NextResponse, type NextRequest } from "next/server";

import { requireAdBuilderRequest } from "@/lib/adbuilder/http";
import {
  ADBUILDER_MEDIA_URL_LIMIT,
  createAdBuilderMediaUrls,
} from "@/lib/adbuilder/media-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await requireAdBuilderRequest(request);
  if (!context.ok) return context.response;

  const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
  if (
    !body ||
    !Array.isArray(body.paths) ||
    body.paths.some((path) => typeof path !== "string") ||
    body.paths.length > ADBUILDER_MEDIA_URL_LIMIT
  ) {
    return NextResponse.json(
      { error: `paths must be an array of up to ${ADBUILDER_MEDIA_URL_LIMIT} strings.` },
      { status: 400 },
    );
  }

  try {
    const urls = await createAdBuilderMediaUrls({
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
