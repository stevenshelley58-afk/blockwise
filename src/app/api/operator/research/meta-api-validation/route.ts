import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { validateOfficialMetaAdLibraryCoverage } from "@/lib/research/meta-official-api";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  country: z.string().length(2).default("AU"),
  adType: z.enum(["HOUSING_ADS", "POLITICAL_AND_ISSUE_ADS", "ALL"]).default("HOUSING_ADS"),
  searchTerms: z.array(z.string()).optional(),
  pageIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  maxPagesPerSearch: z.number().int().min(1).max(10).optional(),
});

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const accessToken = process.env.META_AD_LIBRARY_ACCESS_TOKEN ?? process.env.META_AD_LIBRARY_TOKEN ?? "";
  if (!accessToken.trim()) {
    return NextResponse.json(
      { error: "META_AD_LIBRARY_ACCESS_TOKEN is not configured." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const startedAt = new Date().toISOString();
  const validation = await validateOfficialMetaAdLibraryCoverage({
    accessToken,
    ...parsed.data,
  });

  const { data, error } = await createResearchServiceClient()
    .schema("research")
    .from("official_api_validation_runs")
    .insert({
      country: parsed.data.country.toUpperCase(),
      ad_type: parsed.data.adType,
      search_terms: parsed.data.searchTerms ?? [],
      page_ids: parsed.data.pageIds ?? [],
      status: validation.status,
      useful_for_au_real_estate: validation.usefulForAuRealEstate,
      result_summary: validation.summary,
      raw_sample: validation.sample.slice(0, 25),
      error: validation.error,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message, validation }, { status: 500 });
  }

  return NextResponse.json({ validationRun: data, validation });
}
