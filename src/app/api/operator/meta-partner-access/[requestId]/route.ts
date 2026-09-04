import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import {
  getMetaPartnerAccessRequest,
  META_PARTNER_REQUEST_STATUSES,
  MetaPartnerAccessRequestError,
  updateMetaPartnerAccessStatus,
  type MetaPartnerAccessRequestStatus,
} from "@/lib/providers/meta-partner-access-requests";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ requestId: string }> | { requestId: string };
};

export async function GET(_request: Request, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { requestId } = await Promise.resolve(context.params);
  try {
    const result = await getMetaPartnerAccessRequest(
      createSupabaseServiceClient(),
      requestId,
    );
    return result
      ? NextResponse.json({ request: result })
      : NextResponse.json(
          { error: "Partner-access request was not found." },
          { status: 404 },
        );
  } catch (error) {
    return requestError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { requestId } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as {
    status?: unknown;
    reason?: unknown;
  };
  if (
    typeof body.status !== "string" ||
    !(META_PARTNER_REQUEST_STATUSES as readonly string[]).includes(body.status)
  ) {
    return NextResponse.json(
      { error: "A valid status is required." },
      { status: 400 },
    );
  }
  try {
    const result = await updateMetaPartnerAccessStatus({
      serviceSupabase: createSupabaseServiceClient(),
      requestId,
      status: body.status as MetaPartnerAccessRequestStatus,
      reason: typeof body.reason === "string" ? body.reason : "",
      actorProfileId: auth.userId,
    });
    return NextResponse.json({ request: result });
  } catch (error) {
    return requestError(error);
  }
}

function requestError(error: unknown) {
  if (error instanceof MetaPartnerAccessRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("Meta partner-access operator request failed", error);
  return NextResponse.json(
    { error: "The partner-access request failed." },
    { status: 500 },
  );
}
