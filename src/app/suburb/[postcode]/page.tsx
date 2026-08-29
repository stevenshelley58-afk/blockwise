import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { niche } from "@/config/niche";
import { resolveAdRadarLocationSearch, resolveAdRadarPostcodeSuburbs } from "@/lib/research/ad-radar-location";
import { loadPublicAdRadarCards } from "@/lib/research/public-ad-radar";
import type { PublicAdRadarResponse } from "@/lib/research/public-ad-radar";
import { buildSuburbReportInsights } from "@/lib/research/suburb-report-insights";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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
  const areaSuburbs = orderPostcodeSuburbs(resolveAdRadarPostcodeSuburbs(postcode), locationLabel);
  try {
    const supabase = createSupabaseServiceClient();
    const response = await loadAllPublicAds(supabase, postcode, true);
    return { response, areaSuburbs, label: locationLabel };
  } catch (error) {
    console.error("suburb report data load failed", error);
    return {
      response: { location: { query: postcode, label: locationLabel, matched: false }, ads: [], nextCursor: null, source: "scraped" as const },
      areaSuburbs,
      label: locationLabel,
    };
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { postcode } = await params;
  if (!/^\d{4}$/.test(postcode)) return { title: { absolute: "Suburb report | Blockwise" }, robots: { index: false, follow: false } };
  const report = await loadReport(postcode).catch(() => null);
  if (!report) return { title: { absolute: "Suburb report | Blockwise" }, robots: { index: false, follow: false } };
  const coverage = formatNaturalList(report.areaSuburbs);
  const count = report.response.ads.length;
  const description = `Browse ${count} live ads observed across ${postcode}${coverage ? `, including ${coverage}` : ""}, with local advertiser counts, category patterns and practical ad concepts.`;
  return {
    title: { absolute: `Every live ad across ${postcode} | Blockwise` },
    description,
    alternates: { canonical: `/suburb/${postcode}` },
    openGraph: { title: `Every live ad across ${postcode}`, description, url: `/suburb/${postcode}`, type: "website" },
  };
}

export default async function SuburbReportPage({ params, searchParams }: PageProps) {
  if (!niche.features.suburbPages) notFound();
  const [{ postcode }, query] = await Promise.all([params, searchParams]);
  if (!/^\d{4}$/.test(postcode) || !resolveAdRadarLocationSearch(postcode, { includeSurroundingSuburbs: true })) {
    redirect("/?report=invalid-postcode");
  }
  const report = await loadReport(postcode);
  if (!report) redirect("/?report=invalid-postcode");

  const requestedSuburb = cleanSlug(query.s);
  const suburb = requestedSuburb || suburbFromLabel(report.label, postcode);
  const coverageLabel = requestedSuburb ? "" : formatNaturalList(report.areaSuburbs);
  const ads = report.response.ads;
  const insights = buildSuburbReportInsights(ads, suburb);
  const nearby = ads.length === 0 ? await loadNearby(postcode) : [];

  return (
    <SuburbReportClient
      ads={ads}
      coverageLabel={coverageLabel}
      insights={insights}
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
    const supabase = createSupabaseServiceClient();
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

function orderPostcodeSuburbs(suburbs: string[], primarySuburb: string) {
  const primary = primarySuburb.toLocaleLowerCase("en-AU");
  return [...suburbs].sort((a, b) => {
    const rank = (value: string) => {
      const normalised = value.toLocaleLowerCase("en-AU");
      if (normalised === primary) return 0;
      if (primary && normalised.includes(primary)) return 1;
      return 2;
    };
    return rank(a) - rank(b) || a.localeCompare(b, "en-AU");
  });
}

function formatNaturalList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function cleanSlug(value: string | undefined) {
  if (!value || !/^[a-z0-9-]{1,80}$/i.test(value)) return "";
  return value.split("-").filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`).join(" ");
}

async function loadAllPublicAds(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
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
