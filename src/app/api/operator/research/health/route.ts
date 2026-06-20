import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { loadResearchHealth, researchHealthChecks } from "@/lib/research/health";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const supabase = createSupabaseServiceClient();
  const data = await loadResearchHealth(supabase).catch((error: Error) => ({ error }));

  if ("error" in data) {
    return NextResponse.json(
      {
        status: "red",
        error: data.error.message,
        checks: {
          health_data: {
            ok: false,
            value: "unavailable",
            message: "Research health data could not be read.",
          },
        },
      },
      { status: 503 },
    );
  }

  const checks = researchHealthChecks(data ?? null);
  const healthy = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    {
      status: healthy ? "green" : "red",
      health: data ?? null,
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
