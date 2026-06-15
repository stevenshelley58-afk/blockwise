import { headers } from "next/headers";

import { PageHeading } from "@/components/page-heading";
import { AdRadarSearchPanel } from "@/components/research/ad-radar-search-panel";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  resolveAdRadarLocationGuess,
  resolveAdRadarLocationSearch,
} from "@/lib/research/ad-radar-location";

export const dynamic = "force-dynamic";

type ResearchSort = "recent" | "longest";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResearchPage({ searchParams }: { searchParams?: SearchParams }) {
  await requirePageSurfaceAccess("monitor");
  const requestHeaders = await headers();
  const params = searchParams ? await searchParams : {};
  const searchTerm = firstParam(params.q ?? params.postcode).trim();
  const sort: ResearchSort = firstParam(params.sort) === "longest" ? "longest" : "recent";
  const includeSurrounding = isTruthyParam(firstParam(params.includeSurrounding));
  const locationGuess = searchTerm
    ? resolveAdRadarLocationSearch(searchTerm, { includeSurroundingSuburbs: includeSurrounding })
    : resolveAdRadarLocationGuess(requestHeaders);
  const locationLabel = locationGuess?.label ?? "Perth, WA";

  return (
    <main className="content">
      <PageHeading
        eyebrow="Competitor intelligence"
        title="Ad Radar"
        description="Search live Australian real-estate ads by postcode, suburb, page, Library ID, or ad copy."
      />
      <AdRadarSearchPanel
        initialIncludeSurrounding={includeSurrounding}
        initialQuery={searchTerm}
        initialSort={sort}
        initialLocationLabel={locationLabel}
        initialNote=""
      />
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function isTruthyParam(value: string): boolean {
  return value === "1" || value === "true" || value === "yes";
}
