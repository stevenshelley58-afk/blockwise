import { NextResponse, type NextRequest } from "next/server";

import { recordCustomerActivationMilestone } from "@/lib/activation/customer-activation";
import { normalizeAndValidateExtractionUrl } from "@/lib/adstudio/extraction-url";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Market = "AU" | "US";

type OnboardingMarketBody = {
  workspaceId?: string;
  country?: string;
  websiteUrl?: string;
};

const MARKET_CURRENCY: Record<Market, "AUD" | "USD"> = {
  AU: "AUD",
  US: "USD",
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as OnboardingMarketBody;
  const country = body.country?.trim().toUpperCase();
  if (country !== "AU" && country !== "US") {
    return NextResponse.json({ error: "Choose Australia or the United States." }, { status: 400 });
  }

  const website = normalizeAndValidateExtractionUrl(body.websiteUrl ?? "");
  if (!website.ok) {
    return NextResponse.json({ error: website.error }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "self_serve", body.workspaceId ?? null);
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && guard.access.role !== "owner" && guard.access.role !== "admin") {
    return NextResponse.json({ error: "Only an owner or admin can confirm the workspace market." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const [{ data: workspace, error: workspaceError }, { count: metaConnectionCount, error: connectionError }] =
    await Promise.all([
      service.from("workspaces").select("*").eq("id", guard.access.workspaceId).maybeSingle(),
      service
        .from("provider_connections")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", guard.access.workspaceId)
        .eq("provider", "meta")
        .neq("status", "revoked"),
    ]);

  if (workspaceError || !workspace) {
    return NextResponse.json(
      { error: workspaceError?.message ?? "Workspace was not found." },
      { status: workspaceError ? 500 : 404 },
    );
  }
  if (connectionError) {
    return NextResponse.json({ error: connectionError.message }, { status: 500 });
  }

  const row = workspace as Record<string, unknown>;
  const currentCountry = String(row.country_code ?? row.region ?? "AU").toUpperCase();
  const isMarketBound = Boolean(
    row.billing_checkout_completed_at ||
      row.stripe_customer_id ||
      (metaConnectionCount ?? 0) > 0,
  );
  if (isMarketBound && currentCountry !== country) {
    return NextResponse.json(
      {
        error:
          "Your country and billing currency are already bound to billing or Meta. Contact Blockwise for an assisted workspace migration.",
      },
      { status: 409 },
    );
  }

  const { error: updateError } = await service
    .from("workspaces")
    .update({
      country_code: country,
      billing_currency: MARKET_CURRENCY[country],
      region: country,
      updated_at: new Date().toISOString(),
    })
    .eq("id", guard.access.workspaceId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await recordCustomerActivationMilestone({
    workspaceId: guard.access.workspaceId,
    milestone: "country_confirmed",
    serviceSupabase: service,
  });

  return NextResponse.json({
    workspaceId: guard.access.workspaceId,
    country,
    currency: MARKET_CURRENCY[country],
    websiteUrl: website.url,
  });
}
