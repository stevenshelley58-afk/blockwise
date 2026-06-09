import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "@/lib/research/customer-meta-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const rateLimit = await checkRateLimit(supabase, access.access.workspaceId, access.access.userId, {
    windowSeconds: 60,
    maxRequests: 20,
    bucket: "ads-search",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/[(),]/g, "").trim();
  if (!q) {
    return NextResponse.json({ cards: [] });
  }

  const needle = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";
  const { data, error } = await supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .or(
      [
        `page_name.ilike.${needle}`,
        `library_id.ilike.${needle}`,
        `headline.ilike.${needle}`,
        `body.ilike.${needle}`,
        `description.ilike.${needle}`,
        `postcode.ilike.${needle}`,
        `suburb.ilike.${needle}`,
        `state.ilike.${needle}`,
        `destination_url.ilike.${needle}`,
        `cta.ilike.${needle}`,
      ].join(","),
    )
    .order("last_seen_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cards = ((data ?? []) as unknown as CustomerMetaAdLibraryCardRow[]).map(
    normaliseCustomerMetaAdLibraryCard,
  );

  return NextResponse.json({ cards });
}
