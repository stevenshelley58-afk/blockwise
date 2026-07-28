import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open,investigating";
  const { data, error } = await createResearchServiceClient()
    .schema("research")
    .from("coverage_defects")
    .select("*")
    .in("status", status.split(","))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ defects: data ?? [] });
}
