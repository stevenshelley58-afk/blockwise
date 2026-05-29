import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const { data, error } = await guard.supabase
    .schema("research")
    .from("v_coverage_status")
    .select("*")
    .order("priority", { ascending: true })
    .order("postcode", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ coverage: data ?? [] });
}
