import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  createMetaPartnerAccessRequest,
  getLatestMetaPartnerAccessRequest,
  MetaPartnerAccessRequestError,
} from "@/lib/providers/meta-partner-access-requests";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedWorkspace = request.nextUrl.searchParams.get("workspaceId");
  const guard = await requireApiWorkspace(
    request,
    "monitor",
    requestedWorkspace,
  );
  if (!guard.ok) return guard.response;
  if (!canManageProviderConnections(guard.access)) {
    return NextResponse.json(
      { error: "Only a workspace owner or admin can manage Meta access." },
      { status: 403 },
    );
  }
  try {
    const result = await getLatestMetaPartnerAccessRequest(
      createSupabaseServiceClient(),
      guard.access.workspaceId,
    );
    return NextResponse.json({ request: result });
  } catch (error) {
    return requestError(error);
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const requestedWorkspace =
    typeof body.workspaceId === "string" ? body.workspaceId : null;
  const guard = await requireApiWorkspace(
    request,
    "monitor",
    requestedWorkspace,
  );
  if (!guard.ok) return guard.response;
  if (!canManageProviderConnections(guard.access)) {
    return NextResponse.json(
      { error: "Only a workspace owner or admin can manage Meta access." },
      { status: 403 },
    );
  }
  try {
    const result = await createMetaPartnerAccessRequest({
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: guard.access.workspaceId,
      actorProfileId: guard.access.userId,
      mutationId: body.mutationId as string,
      adAccountId: body.adAccountId,
      pageId: body.pageId,
      instagramAccountId: body.instagramAccountId,
    });
    return NextResponse.json({ request: result }, { status: 201 });
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
  console.error("Meta partner-access request failed", error);
  return NextResponse.json(
    { error: "The Meta partner-access request failed." },
    { status: 500 },
  );
}
