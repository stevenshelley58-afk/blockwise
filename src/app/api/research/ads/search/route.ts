import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  adRunningMs,
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "@/lib/research/customer-meta-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SEARCH_ROW_LIMIT = 200;
const SEARCH_RESULT_LIMIT = 50;
type SearchSort = "recent" | "longest";

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
  const sort: SearchSort = request.nextUrl.searchParams.get("sort") === "longest" ? "longest" : "recent";
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
    .order(sort === "longest" ? "ad_delivery_started_at" : "last_seen_at", {
      ascending: sort === "longest",
      nullsFirst: false,
    })
    .limit(SEARCH_ROW_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cards = sortCards(
    dedupeRowsByCardId((data ?? []) as unknown as CustomerMetaAdLibraryCardRow[])
      .slice(0, SEARCH_RESULT_LIMIT)
      .map(normaliseCustomerMetaAdLibraryCard),
    sort,
  );

  return NextResponse.json({ cards });
}

function sortCards(cards: CustomerMetaAdLibraryCard[], sort: SearchSort): CustomerMetaAdLibraryCard[] {
  if (sort === "longest") {
    const now = Date.now();
    return [...cards].sort((a, b) => {
      const aMs = adRunningMs(a.startedAt, a.stoppedAt, now);
      const bMs = adRunningMs(b.startedAt, b.stoppedAt, now);
      return (bMs ?? -1) - (aMs ?? -1) || dateValue(b.lastSeenAt) - dateValue(a.lastSeenAt);
    });
  }

  return [...cards].sort((a, b) => dateValue(b.lastSeenAt) - dateValue(a.lastSeenAt));
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function dedupeRowsByCardId(rows: CustomerMetaAdLibraryCardRow[]): CustomerMetaAdLibraryCardRow[] {
  const seen = new Set<string>();
  const deduped: CustomerMetaAdLibraryCardRow[] = [];

  for (const row of rows) {
    const cardId = row.card_id?.trim();
    if (cardId) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
    }
    deduped.push(row);
  }

  return deduped;
}
