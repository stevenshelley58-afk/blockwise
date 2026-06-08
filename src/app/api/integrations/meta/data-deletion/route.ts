import { NextResponse, type NextRequest } from "next/server";

import {
  buildConfirmationCode,
  loadDeletionStatus,
  parseAndVerifySignedRequest,
  processMetaDataDeletionRequest,
  recordDeletionRequest,
} from "@/lib/meta/data-deletion";

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
    await processMetaDataDeletionRequest(confirmationCode);
  } catch (error) {
    // We still return success to Meta; failing the callback would just cause Meta
    // to retry the same request later. We log the failure for our own follow-up.
    console.error("[meta-data-deletion] failed to persist deletion request", error);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? request.nextUrl.origin;

  return NextResponse.json({
    url: `${origin}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

export async function GET(request: NextRequest) {
  const confirmationCode = request.nextUrl.searchParams.get("code");

  if (confirmationCode) {
    const status = await loadDeletionStatus(confirmationCode);

    if (!status) {
      return NextResponse.json({ error: "Confirmation code was not found." }, { status: 404 });
    }

    return NextResponse.json(status);
  }

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
