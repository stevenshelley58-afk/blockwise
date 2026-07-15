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
    const stylesheetTextByUrl = await fetchWebsiteStylesheets(normalizedUrl, html);
    const brandKit = extractBrandKitFromWebsite({
      workspaceId: context.access.workspaceId,
      websiteUrl: normalizedUrl,
      marketCountry: body.marketCountry ?? "AU",
      marketRegion: body.marketRegion ?? context.access.region ?? "WA",
      htmlByUrl: {
        [normalizedUrl]: html,
      },
      stylesheetTextByUrl,
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
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-AU,en;q=0.9",
    },
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

async function fetchWebsiteStylesheets(websiteUrl: string, html: string): Promise<Record<string, string>> {
  const stylesheetUrls = extractStylesheetUrls(websiteUrl, html).slice(0, 3);
  const entries = await Promise.all(
    stylesheetUrls.map(async (stylesheetUrl): Promise<[string, string] | null> => {
      if (new URL(stylesheetUrl).origin !== new URL(websiteUrl).origin) return null;

      try {
        const response = await fetch(stylesheetUrl, {
          cache: "no-store",
          headers: {
            ...browserHeaders("text/css,*/*;q=0.1"),
            Referer: websiteUrl,
            "Sec-Fetch-Dest": "style",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Site": "same-origin",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok || new URL(response.url).origin !== new URL(websiteUrl).origin) return null;
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType && !/text\/css|text\/plain|application\/octet-stream/i.test(contentType)) return null;
        return [stylesheetUrl, await readCappedText(response, 1_500_000)];
      } catch {
        return null;
      }
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null));
}

function extractStylesheetUrls(websiteUrl: string, html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!/\bstylesheet\b/i.test(rel) || !href) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), websiteUrl);
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.toString());
    } catch {
      continue;
    }
  }
  return [...urls];
}

function browserHeaders(accept: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    Accept: accept,
    "Accept-Language": "en-AU,en;q=0.9",
  };
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
