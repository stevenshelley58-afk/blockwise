import type { Metadata } from "next";
import { cache } from "react";
import { redirect } from "next/navigation";

import { resolveAdRadarLocationSearch } from "@/lib/research/ad-radar-location";
import { loadPublicAdRadarCards } from "@/lib/research/public-ad-radar";
import type { PublicAdRadarResponse } from "@/lib/research/public-ad-radar";
import { buildSuburbReportInsights } from "@/lib/research/suburb-report-insights";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { SuburbReportClient } from "./report-client";
import "./suburb-report.css";

export const revalidate = 300;

type PageProps = {
  params: Promise<{ postcode: string }>;
  searchParams: Promise<{ s?: string; scan?: string }>;
};

const loadReport = cache(async (postcode: string) => {
  const location = resolveAdRadarLocationSearch(postcode, { includeSurroundingSuburbs: true });
  if (!location) return null;
  const locationLabel = location.terms.find((term) => !/^\d{4}$/.test(term) && !/^(WA|Western Australia)$/i.test(term)) || location.label;
  try {
    const supabase = await createSupabaseServerClient();
    const exact = await loadAllPublicAds(supabase, postcode, false);
    if (exact.ads.length >= 5) return { response: exact, isSurrounds: false, label: locationLabel };
    const widened = await loadAllPublicAds(supabase, postcode, true);
    return { response: widened, isSurrounds: widened.ads.length > exact.ads.length, label: locationLabel };
  } catch (error) {
    console.error("suburb report data load failed", error);
    return {
      response: { location: { query: postcode, label: locationLabel, matched: false }, ads: [], nextCursor: null, source: "scraped" as const },
      isSurrounds: false,
      label: locationLabel,
    };
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { postcode } = await params;
  if (!/^\d{4}$/.test(postcode)) return { title: "Suburb report | Blockwise", robots: { index: false, follow: false } };
  const report = await loadReport(postcode).catch(() => null);
  if (!report) return { title: "Suburb report | Blockwise", robots: { index: false, follow: false } };
  const suburb = suburbFromLabel(report.label, postcode);
  const count = report.response.ads.length;
  const description = `Browse ${count} live ads observed in ${suburb} ${postcode}, with local advertiser counts, category patterns and practical ad concepts.`;
  return {
    title: `Every live ad in ${suburb} ${postcode} | Blockwise`,
    description,
    alternates: { canonical: `/suburb/${postcode}` },
    openGraph: { title: `Every live ad in ${suburb} ${postcode}`, description, url: `/suburb/${postcode}`, type: "website" },
  };
}

export default async function SuburbReportPage({ params, searchParams }: PageProps) {
  const [{ postcode }, query] = await Promise.all([params, searchParams]);
  if (!/^\d{4}$/.test(postcode) || !resolveAdRadarLocationSearch(postcode, { includeSurroundingSuburbs: true })) {
    redirect("/?report=invalid-postcode");
  }
  const report = await loadReport(postcode);
  if (!report) redirect("/?report=invalid-postcode");

  const requestedSuburb = cleanSlug(query.s);
  const suburb = requestedSuburb || suburbFromLabel(report.label, postcode);
  const ads = report.response.ads;
  const insights = buildSuburbReportInsights(ads, suburb);
  const nearby = ads.length === 0 ? await loadNearby(postcode) : [];

  return (
    <SuburbReportClient
      ads={ads}
      insights={insights}
      isSurrounds={report.isSurrounds}
      nearby={nearby}
      playScan={query.scan === "1"}
      postcode={postcode}
      suburb={suburb}
    />
  );
}

async function loadNearby(postcode: string) {
  const fallback = postcode === "6160"
    ? [{ postcode: "6158", suburb: "East Fremantle" }, { postcode: "6159", suburb: "North Fremantle" }, { postcode: "6162", suburb: "South Fremantle" }]
    : [{ postcode: "6000", suburb: "Perth" }, { postcode: "6008", suburb: "Subiaco" }, { postcode: "6050", suburb: "Mount Lawley" }];
  try {
    const supabase = await createSupabaseServerClient();
    return await Promise.all(fallback.map(async (area) => {
      const result = await loadPublicAdRadarCards(supabase, { location: area.postcode, limit: 36, sort: "longest" });
      return { ...area, count: result.ads.length };
    }));
  } catch {
    return fallback.map((area) => ({ ...area, count: 0 }));
  }
}

function suburbFromLabel(label: string, postcode: string) {
  const value = label.replace(new RegExp(`\\b${postcode}\\b`, "g"), "").replace(/\b(WA|Western Australia|Australia)\b/gi, "").replace(/[,\s]+$/g, "").trim();
  return value || "Your suburb";
}

function cleanSlug(value: string | undefined) {
  if (!value || !/^[a-z0-9-]{1,80}$/i.test(value)) return "";
  return value.split("-").filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`).join(" ");
}

async function loadAllPublicAds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  postcode: string,
  includeSurroundingSuburbs: boolean,
): Promise<PublicAdRadarResponse> {
  const ads = new Map<string, PublicAdRadarResponse["ads"][number]>();
  let cursor: string | null = null;
  let response: PublicAdRadarResponse | null = null;

  for (let page = 0; page < 4; page += 1) {
    response = await loadPublicAdRadarCards(supabase, {
      location: postcode,
      cursor,
      includeSurroundingSuburbs,
      limit: 36,
      sort: "longest",
    });
    for (const ad of response.ads) ads.set(ad.id, ad);
    cursor = response.nextCursor;
    if (!cursor) break;
  }

  return response
    ? { ...response, ads: [...ads.values()], nextCursor: cursor }
    : { location: { query: postcode, label: postcode, matched: false }, ads: [], nextCursor: null, source: "scraped" };
}
