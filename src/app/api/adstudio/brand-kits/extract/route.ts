import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { buildAdStudioLiveResult, extractBrandKitFromWebsite } from "@/lib/adstudio";
import { normalizeAndValidateExtractionUrl } from "@/lib/adstudio/extraction-url";
import { isExampleBrandKitSourceUrl, persistAdStudioBrandKit } from "@/lib/adstudio/persistence";

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
    const validated = normalizeAndValidateExtractionUrl(websiteUrl);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const normalizedUrl = validated.url;
    if (isExampleBrandKitSourceUrl(normalizedUrl)) {
      return NextResponse.json({ error: "Use your real agency website, not a demo domain." }, { status: 400 });
    }
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

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error("Website extraction requires an HTML page.");
  }

  return readCappedText(response, 1_000_000);
}

async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Website extraction page is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
