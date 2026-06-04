import { NextResponse } from "next/server";

import { getDeploymentReadiness } from "@/lib/config/env";

export const runtime = "nodejs";

export function GET() {
  const readiness = getDeploymentReadiness();

  return NextResponse.json({
    app: "blockwise",
    status: readiness.ok ? "ready" : "configuration_incomplete",
    readiness,
  });
}
