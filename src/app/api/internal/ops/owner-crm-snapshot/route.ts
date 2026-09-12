import { NextResponse } from "next/server";

import { verifyOwnerCrmSnapshotRequest } from "@/lib/owner-crm/auth";
import {
  parseOwnerCrmSnapshotPageRequest,
  readOwnerCrmCustomerSnapshotPage,
} from "@/lib/owner-crm/customer-snapshot";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal Hermes-facing observation endpoint. It is read-only and requires
 * scoped HMAC headers. Customer and legacy bearer credentials are rejected.
 */
export async function GET(request: Request) {
  const auth = await verifyOwnerCrmSnapshotRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let pageRequest;
  try {
    pageRequest = parseOwnerCrmSnapshotPageRequest(new URL(request.url).searchParams);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_snapshot_request" },
      { status: 400 },
    );
  }

  try {
    const snapshot = await readOwnerCrmCustomerSnapshotPage(createSupabaseServiceClient(), pageRequest);
    return NextResponse.json(snapshot, { status: 200 });
  } catch (error) {
    console.error("[owner-crm-snapshot] read failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "owner_crm_snapshot_unavailable" }, { status: 503 });
  }
}
