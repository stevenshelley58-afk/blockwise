import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/modules/adstudio/http";
import { buildAdStudioLiveResult, extractBrandKitFromWebsite } from "@/modules/adstudio";
import { persistAdStudioBrandKit } from "@/modules/adstudio/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExtractBody = {
  websiteUrl?: string;
  website_url?: string;
  html?: string;
  marketCountry?: "AU";
  marketRegion?: string;
  forceRecrawl?: boolean;
};

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<ExtractBody>(request);
  const websiteUrl = body.websiteUrl ?? body.website_url;

  if (!websiteUrl) {
    return NextResponse.json({ error: "websiteUrl is required." }, { status: 400 });
  }

  try {
    const normalizedUrl = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    const html = body.html ?? (await fetchWebsiteHtml(normalizedUrl));
    const brandKit = extractBrandKitFromWebsite({
      workspaceId: context.access.workspaceId,
      websiteUrl: normalizedUrl,
      marketCountry: body.marketCountry ?? "AU",
      marketRegion: body.marketRegion ?? context.access.region ?? "WA",
      htmlByUrl: {
        [normalizedUrl]: html,
      },
    });
    const persisted = await persistAdStudioBrandKit(context.supabase, brandKit, context.access.userId);
    const liveResult = buildAdStudioLiveResult({
      data: brandKit,
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json(
      {
        brandKit: liveResult.data,
        data: liveResult.data,
        persistence: liveResult.persistence,
        job: { status: persisted.error ? "succeeded_with_persistence_warning" : "succeeded" },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, 502);
  }
}

async function fetchWebsiteHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Website extraction failed with ${response.status}.`);
  }

  return response.text();
}
