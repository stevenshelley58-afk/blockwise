import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await guard.supabase
    .schema("research")
    .from("work_queue")
    .update({
      status: "pending",
      attempts: 0,
      available_at: new Date().toISOString(),
      claimed_at: null,
      claimed_by: null,
      claim_token: null,
      claim_expires_at: null,
      last_error: null,
      blocked_reason: null,
    })
    .eq("id", id)
    .in("status", ["failed", "blocked"])
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Failed or blocked job not found." }, { status: 404 });
  return NextResponse.json({ job: data });
}
