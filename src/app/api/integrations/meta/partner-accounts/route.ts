import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  getMetaPartnerConfig,
  listPartnerVisibleAdAccounts,
  type PartnerAdAccountCandidate,
} from "@/lib/providers/meta-partner";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimedAccountRow = { external_account_id: string | null };

/**
 * Polling endpoint behind the connect modal. Returns every ad account
 * currently shared with Blockwise's Business Manager, flagged by whether a
 * workspace has already claimed it. The customer's freshly-shared account
 * appears here within one Meta Graph call of her saving on the Partners page.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;

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

  let accounts: PartnerAdAccountCandidate[];
  try {
    accounts = await listPartnerVisibleAdAccounts(config.systemToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta asset request failed.";
    return NextResponse.json(
      { configured: true, businessId: config.businessId, accounts: [], error: message },
      { status: 502 },
    );
  }

  const serviceSupabase = createSupabaseServiceClient();
  const { data: claimedRows } = await serviceSupabase
    .from("provider_connections")
    .select("external_account_id")
    .eq("provider", "meta")
    .neq("status", "not_connected");

  const claimed = new Set(
    ((claimedRows ?? []) as ClaimedAccountRow[])
      .map((row) => row.external_account_id)
      .filter((id): id is string => Boolean(id)),
  );

  return NextResponse.json({
    configured: true,
    businessId: config.businessId,
    accounts: accounts.map((account) => ({
      ...account,
      claimed: claimed.has(account.id),
    })),
  });
}
