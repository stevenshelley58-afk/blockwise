import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { normalizeAndValidateExtractionUrl, isAustralianListingDomain } from "@/lib/adstudio/extraction-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LISTING_SCRAPER_URL = process.env.LISTING_SCRAPER_URL || "";
const HERMES_API_SERVER_KEY = process.env.HERMES_API_SERVER_KEY || "";

type ExtractBody = {
  url?: string;
};

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<ExtractBody>(request);
  const rawUrl = body.url?.trim();

  if (!rawUrl) {
    return NextResponse.json({ ok: false, error: "invalid_url", message: "Listing URL is required." }, { status: 400 });
  }

  // SSRF guard
  const validated = normalizeAndValidateExtractionUrl(rawUrl);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: "invalid_url", message: validated.error }, { status: 400 });
  }

  // AU domain allowlist
  let hostname: string;
  try {
    hostname = new URL(validated.url).hostname;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_url", message: "Invalid URL." }, { status: 400 });
  }

  if (!isAustralianListingDomain(hostname)) {
    return NextResponse.json(
      { ok: false, error: "invalid_url", message: "Only Australian property listing URLs (.com.au / .au) are supported." },
      { status: 400 },
    );
  }

  // Check VPS scraper is configured
  if (!LISTING_SCRAPER_URL || !HERMES_API_SERVER_KEY) {
    return NextResponse.json(
      { ok: false, error: "service_unavailable", message: "Listing extraction is not configured. Enter details manually." },
      { status: 503 },
    );
  }

  try {
    const scraperResponse = await fetch(LISTING_SCRAPER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": HERMES_API_SERVER_KEY,
      },
      body: JSON.stringify({
        url: validated.url,
        workspaceId: context.access.workspaceId,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    const result = await scraperResponse.json();

    if (!scraperResponse.ok) {
      const error = (result as { error?: string; message?: string }).error || "blocked";
      const message = (result as { message?: string }).message || "Listing extraction failed. Try again or enter details manually.";
      return NextResponse.json({ ok: false, error, message }, { status: scraperResponse.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    // Network error reaching VPS
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { ok: false, error: "timeout", message: "The listing took too long to load. Try again, or enter details manually." },
        { status: 504 },
      );
    }
    return errorResponse(error, 502);
  }
}
