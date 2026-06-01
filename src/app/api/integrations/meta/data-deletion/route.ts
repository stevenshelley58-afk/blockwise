import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServiceClient } from "@/modules/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta Data Deletion Callback
 * ---------------------------
 * Meta sends a POST with form-encoded body `signed_request=<base64url>.<base64url>`.
 * The first part is the HMAC-SHA256 of the second part, signed with the app secret.
 * The decoded second part is JSON containing { algorithm, expires, issued_at, user_id, ... }.
 *
 * We:
 *  1. Verify the signature against META_APP_SECRET.
 *  2. Insert a deletion request row keyed by user_id for asynchronous processing.
 *  3. Return { url, confirmation_code } per Meta's spec.
 *
 * Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export async function POST(request: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    return NextResponse.json({ error: "Meta app secret is not configured." }, { status: 500 });
  }

  const signedRequest = await readSignedRequest(request);

  if (!signedRequest) {
    return NextResponse.json({ error: "Missing signed_request parameter." }, { status: 400 });
  }

  const parsed = parseAndVerifySignedRequest(signedRequest, appSecret);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const userId = typeof parsed.payload.user_id === "string" ? parsed.payload.user_id : null;

  if (!userId) {
    return NextResponse.json({ error: "Signed request did not include a user_id." }, { status: 400 });
  }

  const confirmationCode = buildConfirmationCode(userId);

  try {
    await recordDeletionRequest(userId, confirmationCode, parsed.payload);
  } catch (error) {
    // We still return success to Meta — failing the callback would just cause Meta
    // to retry the same request later. We log the failure for our own follow-up.
    console.error("[meta-data-deletion] failed to persist deletion request", error);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;

  return NextResponse.json({
    url: `${origin}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

export function GET() {
  // Meta does not call GET on this endpoint, but a probe from operators or
  // App Review reviewers should not 404.
  return NextResponse.json({
    endpoint: "meta_data_deletion_callback",
    method: "POST",
    expects: "signed_request",
    docs: "https://blockwise.sale/data-deletion",
  });
}

async function readSignedRequest(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { signed_request?: string };

    return body.signed_request ?? null;
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const value = form.get("signed_request");

    return typeof value === "string" ? value : null;
  }

  // Fall back to query string in case Meta uses GET-style encoding.
  return request.nextUrl.searchParams.get("signed_request");
}

type SignedRequestResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

export function parseAndVerifySignedRequest(signedRequest: string, appSecret: string): SignedRequestResult {
  const parts = signedRequest.split(".");

  if (parts.length !== 2) {
    return { ok: false, error: "signed_request must contain exactly two parts." };
  }

  const [encodedSignature, encodedPayload] = parts;
  const signature = base64UrlDecodeToBuffer(encodedSignature);
  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();

  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return { ok: false, error: "signed_request signature is invalid." };
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(base64UrlDecodeToBuffer(encodedPayload).toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "signed_request payload is not valid JSON." };
  }

  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return { ok: false, error: "signed_request algorithm must be HMAC-SHA256." };
  }

  return { ok: true, payload };
}

function base64UrlDecodeToBuffer(value: string): Buffer {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(standard, "base64");
}

function buildConfirmationCode(userId: string): string {
  const stamp = Date.now().toString(36);
  const hash = createHash("sha256").update(`${userId}:${stamp}`).digest("hex").slice(0, 12);

  return `bw_${stamp}_${hash}`;
}

async function recordDeletionRequest(
  metaUserId: string,
  confirmationCode: string,
  payload: Record<string, unknown>,
) {
  const supabase = createSupabaseServiceClient();
  const issuedAt =
    typeof payload.issued_at === "number"
      ? new Date(payload.issued_at * 1000).toISOString()
      : new Date().toISOString();

  const { error } = await supabase
    .from("meta_data_deletion_requests")
    .upsert(
      {
        meta_user_id: metaUserId,
        confirmation_code: confirmationCode,
        status: "queued",
        signed_request_payload: payload,
        issued_at: issuedAt,
        requested_at: new Date().toISOString(),
      },
      { onConflict: "meta_user_id" },
    );

  if (error) {
    throw new Error(error.message);
  }
}
