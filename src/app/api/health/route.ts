import { NextResponse } from "next/server";

import { getDeploymentReadiness } from "@/lib/config/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type SupabaseReadiness = {
  ok: boolean;
  status: "connected" | "configuration_incomplete" | "error";
  checkedAt: string;
  message?: string;
};

export async function GET() {
  const readiness = getDeploymentReadiness();
  const supabase = await getSupabaseReadiness();
  const ready = readiness.ok && supabase.ok;

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
  });
}

async function getSupabaseReadiness(): Promise<SupabaseReadiness> {
  const checkedAt = new Date().toISOString();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: "configuration_incomplete", checkedAt };
  }

  try {
    const supabase = createSupabaseServiceClient();
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
