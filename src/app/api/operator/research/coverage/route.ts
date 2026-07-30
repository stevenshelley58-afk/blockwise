import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { data, error } = await createResearchServiceClient()
    .schema("research")
    .from("v_coverage_status")
    .select("*")
    .order("priority", { ascending: true })
    .order("postcode", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ coverage: data ?? [] });
}
