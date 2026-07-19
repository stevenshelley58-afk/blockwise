import { NextResponse, type NextRequest } from "next/server";

import {
  parseAndVerifySignedRequest,
  processMetaDeauthorizeRequest,
} from "@/lib/meta/data-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta Deauthorize Callback
 * -------------------------
 * Meta sends a POST with form-encoded body `signed_request=<sig>.<payload>`
 * when a user removes the app from their Facebook settings or Business
 * Integrations. We verify the HMAC-SHA256 signature against META_APP_SECRET,
 * null the stored vault tokens, and mark the provider connection revoked.
 *
 * Lead data is intentionally not deleted here; deletion runs through the
 * Data Deletion Callback (`/api/integrations/meta/data-deletion`), which
 * records an auditable request with a confirmation code.
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

  try {
    await processMetaDeauthorizeRequest(userId);
  } catch (error) {
    // Return success to Meta regardless; a failure here would only make Meta
    // retry the same notification. We log for our own follow-up.
    console.error("[meta-deauthorize] failed to revoke provider connections", error);
  }

  return NextResponse.json({ success: true });
}

export async function GET() {
  // Meta does not call GET on this endpoint, but a probe from operators or
  // App Review reviewers should not 404.
  return NextResponse.json({
    endpoint: "meta_deauthorize_callback",
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

  return request.nextUrl.searchParams.get("signed_request");
}
