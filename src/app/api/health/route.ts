import { NextResponse } from "next/server";

import { getDeploymentReadiness } from "@/lib/config/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveSupabaseServerCredential } from "@/lib/supabase/credentials";

export const runtime = "nodejs";

type SupabaseReadiness = {
  ok: boolean;
  status: "connected" | "configuration_incomplete" | "error";
  checkedAt: string;
  message?: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const authenticated = secret && authorization === `Bearer ${secret}`;

  const readiness = getDeploymentReadiness();
  const supabase = await getSupabaseReadiness();
  const ready = readiness.ok && supabase.ok;
  const status = ready ? 200 : 503;

  if (!authenticated) {
    return NextResponse.json({ app: "blockwise", status: ready ? "ready" : "degraded" }, { status });
  }

  return NextResponse.json({
    app: "blockwise",
    status: ready ? "ready" : "configuration_incomplete",
    readiness: {
      ...readiness,
      supabase,
    },
    checks: {
      configuration: {
        ok: readiness.ok,
        missing: readiness.missing,
        invalid: readiness.invalid,
      },
      supabase,
    },
  }, { status });
}

async function getSupabaseReadiness(): Promise<SupabaseReadiness> {
  const checkedAt = new Date().toISOString();
  // The public Supabase URL is routed through Frank's shared edge. During
  // startup product-caddy waits for this app to become healthy, so readiness
  // uses the in-network PostgREST URL when Compose provides it.
  const readinessUrl = process.env.BLOCKWISE_READINESS_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!readinessUrl || !resolveSupabaseServerCredential()) {
    return { ok: false, status: "configuration_incomplete", checkedAt };
  }

  try {
    const supabase = createSupabaseServiceClient({
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: readinessUrl },
    });
    const { error } = await supabase.from("workspaces").select("id").limit(1);

    if (error) {
      return { ok: false, status: "error", checkedAt, message: error.message };
    }

    return { ok: true, status: "connected", checkedAt };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      checkedAt,
      message: error instanceof Error ? error.message : "Supabase readiness check failed.",
    };
  }
}
