import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AdRadarSearchPanel } from "@/components/research/ad-radar-search-panel";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  resolveAdRadarLocationGuess,
  resolveAdRadarLocationSearch,
} from "@/lib/research/ad-radar-location";
import { resolveBrandPackLocation } from "@/lib/research/brand-pack-suburb";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResearchPage({ searchParams }: { searchParams?: SearchParams }) {
  if (!niche.features.adRadar) notFound();
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const requestHeaders = await headers();
  const params = searchParams ? await searchParams : {};
  const searchTerm = firstParam(params.q ?? params.postcode).trim();
  const locationGuess = searchTerm
    ? resolveAdRadarLocationSearch(searchTerm)
    : resolveAdRadarLocationGuess(requestHeaders);
  const locationLabel = locationGuess?.label ?? "Perth, WA";

  // Brand Pack suburb -> auto-load target. Only consulted when the visitor did
  // not type a query; falls back to the IP-derived guess resolved above.
  const { data: brandKitRow } = await supabase
    .from("adstudio_brand_kits")
    .select("contact_json")
    .eq("workspace_id", access.workspaceId)
    .limit(1)
    .maybeSingle();
  const brandAddress =
    (brandKitRow as { contact_json?: { address?: string | null } | null } | null)?.contact_json?.address ?? null;
  const brandLocation = resolveBrandPackLocation(brandAddress);

  const autoSearch = searchTerm
    ? null
    : (brandLocation ?? (locationGuess ? { searchTerm: locationGuess.label, label: locationGuess.label } : null));
  const autoSearchSource: "brand_pack" | "location" | null = searchTerm
    ? null
    : brandLocation
      ? "brand_pack"
      : locationGuess
        ? "location"
        : null;

  return (
    <main className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <header>
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          {niche.copy.adRadar.title}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{niche.copy.adRadar.lead}</p>
      </header>
      <AdRadarSearchPanel
        initialQuery={searchTerm}
        initialLocationLabel={locationLabel}
        initialNote=""
        autoSearchTerm={autoSearch?.searchTerm ?? null}
        autoSearchLabel={autoSearch?.label ?? null}
        autoSearchSource={autoSearchSource}
      />
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
