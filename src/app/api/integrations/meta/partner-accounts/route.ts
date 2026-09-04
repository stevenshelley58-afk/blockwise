import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  getMetaPartnerConfig,
  isMetaPartnerStartEnabled,
  verifyPartnerAccountAccess,
} from "@/lib/providers/meta-partner";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssignmentRow = {
  ad_account_id: string;
  ad_account_name: string;
  currency: string;
  timezone: string;
};

/**
 * Polling endpoint behind the connect modal. Returns every ad account
 * assigned to this workspace by an operator. Never enumerates the Business
 * Manager's shared asset pool to a customer session.
 */
export async function GET(request: NextRequest) {
  if (!isMetaPartnerStartEnabled()) return NextResponse.json({ error: "Meta partner access is not currently enabled." }, { status: 503 });
  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  if (!canManageProviderConnections(guard.access)) {
    return NextResponse.json({ error: "Provider connection management is not allowed." }, { status: 403 });
  }

  const config = getMetaPartnerConfig();
  if (!config) {
    return NextResponse.json({
      configured: false,
      businessId: null,
      accounts: [],
      error:
        "Meta partner access is still being set up on our side. Please check back shortly.",
    });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const [{ data: assignment, error: assignmentError }, { data: connection }] = await Promise.all([
    serviceSupabase
      .from("meta_partner_account_assignments")
      .select("ad_account_id,ad_account_name,currency,timezone")
      .eq("workspace_id", guard.access.workspaceId)
      .maybeSingle(),
    serviceSupabase
      .from("provider_connections")
      .select("external_account_id,status")
      .eq("workspace_id", guard.access.workspaceId)
      .eq("provider", "meta")
      .neq("status", "not_connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 });
  const assigned = assignment as AssignmentRow | null;
  if (!assigned) {
    return NextResponse.json({ configured: true, businessId: config.businessId, accounts: [] });
  }
  const accessible = await verifyPartnerAccountAccess(config.systemToken, assigned.ad_account_id).catch(() => false);
  if (!accessible) {
    return NextResponse.json(
      { configured: true, businessId: config.businessId, accounts: [], error: "The assigned Meta account is no longer shared with Blockwise." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    configured: true,
    businessId: config.businessId,
    accounts: [{
      id: assigned.ad_account_id,
      name: assigned.ad_account_name,
      currency: assigned.currency,
      timezone: assigned.timezone,
      isActive: true,
      businessName: null,
      claimed: connection?.external_account_id === assigned.ad_account_id,
    }],
  });
}
