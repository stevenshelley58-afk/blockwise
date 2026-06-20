import { NextResponse } from "next/server";

import { loadResearchHealth, publicResearchChecks } from "@/lib/research/health";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const authenticated = secret && authorization === `Bearer ${secret}`;

  const supabase = createSupabaseServiceClient();
  const data = await loadResearchHealth(supabase).catch((error: Error) => ({ error }));

  if ("error" in data) {
    if (!authenticated) {
      return NextResponse.json({ app: "blockwise", service: "research", status: "red" }, { status: 503 });
    }
    return NextResponse.json(
      {
        app: "blockwise",
        service: "research",
        status: "red",
        checks: {
          health_data: { ok: false, value: data.error.message },
        },
      },
      { status: 503 },
    );
  }

  const checks = publicResearchChecks(data);
  const healthy = Object.values(checks).every((check) => check.ok);

  if (!authenticated) {
    return NextResponse.json({ app: "blockwise", service: "research", status: healthy ? "green" : "red" }, { status: healthy ? 200 : 503 });
  }

  return NextResponse.json(
    {
      app: "blockwise",
      service: "research",
      status: healthy ? "green" : "red",
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
