import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  featureDisabledResponse,
  requireApiWorkspace,
} from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  AdDbConfigurationError,
  fetchAdDbMedia,
} from "@/lib/research/ad-db-client";
import {
  adMediaDerivative,
  derivativeFormat,
  shouldDerivative,
} from "@/lib/research/ad-media-derivative";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params:
    | Promise<{ adId: string; mediaId: string }>
    | { adId: string; mediaId: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyMedia(request, context, "GET");
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return proxyMedia(request, context, "HEAD");
}

async function proxyMedia(
  request: NextRequest,
  context: RouteContext,
  method: "GET" | "HEAD",
) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const limited = await checkRateLimit(
    guard.access.workspaceId,
    guard.access.userId,
    {
      windowSeconds: 60,
      maxRequests: 120,
      bucket: "ad-db-media",
    },
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
      },
    );
  }

  const { adId, mediaId } = await Promise.resolve(context.params);
  if (!isUuid(adId) || !isUuid(mediaId))
    return NextResponse.json({ error: "Media not found." }, { status: 404 });

  try {
    const upstream = await fetchAdDbMedia(adId, mediaId, {
      method,
      range: request.headers.get("range"),
      ifRange: request.headers.get("if-range"),
    }, { signal: request.signal });
    if (upstream.status === 404)
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    if (!upstream.ok) {
      console.error("[ad-db] media upstream failed", {
        status: upstream.status,
      });
      return NextResponse.json(
        { error: "Ad media is unavailable." },
        { status: 502 },
      );
    }
    // Archive images are 2048px and several megabytes, and the Ad DB ignores
    // every resize parameter, so the bytes are downscaled here instead. Range
    // requests and anything that is not a large image keep streaming untouched,
    // and a resize failure serves the original bytes rather than an error.
    let buffered: Uint8Array<ArrayBuffer> | null = null;
    if (
      shouldDerivative({
        method,
        range: request.headers.get("range"),
        contentType: upstream.headers.get("content-type"),
        contentLength: Number(upstream.headers.get("content-length") ?? 0),
      })
    ) {
      buffered = new Uint8Array(await upstream.arrayBuffer());
      try {
        const format = derivativeFormat(request.headers.get("accept"));
        // The source length is part of the key so a replaced object re-renders
        // instead of serving a derivative of the bytes it used to hold.
        const cacheKey = `${adId}:${mediaId}:${buffered.byteLength}`;
        const derivative = await adMediaDerivative(cacheKey, buffered, format);
        return new Response(method === "HEAD" ? null : derivative.body, {
          status: 200,
          headers: derivativeHeaders(upstream.headers, derivative.contentType, derivative.body.byteLength, `${cacheKey}:${format}`),
        });
      } catch (error) {
        console.error("[ad-db] media derivative failed, serving the original", error);
      }
    }

    return new Response(method === "HEAD" ? null : (buffered ?? upstream.body), {
      status: upstream.status,
      headers: safeMediaHeaders(upstream.headers),
    });
  } catch (error) {
    if (error instanceof AdDbConfigurationError) {
      return NextResponse.json(
        { error: "Ad DB is not configured." },
        { status: 503 },
      );
    }
    console.error("[ad-db] media request failed", error);
    return NextResponse.json(
      { error: "Ad media is unavailable." },
      { status: 502 },
    );
  }
}

const MEDIA_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
];
function safeMediaHeaders(source: Headers): Headers {
  const headers = new Headers({ "X-Content-Type-Options": "nosniff" });
  for (const name of MEDIA_HEADERS) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

/**
 * Headers for a derivative response. Range support is deliberately absent: the
 * body is a re-encoded image, not a byte range of the original object.
 */
function derivativeHeaders(
  source: Headers,
  contentType: string,
  byteLength: number,
  key: string,
): Headers {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "content-type": contentType,
    "content-length": String(byteLength),
    "cache-control": source.get("cache-control") ?? "private, max-age=31536000, immutable",
    etag: `"${createHash("sha256").update(key).update(String(byteLength)).digest("hex").slice(0, 32)}"`,
  });
  return headers;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
