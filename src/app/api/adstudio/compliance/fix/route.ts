import { NextResponse, type NextRequest } from "next/server";

import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<{ copy?: string }>(request);

  return NextResponse.json({
    fixedCopy:
      body.copy
        ?.replace(/\bguaranteed\b/gi, "planned")
        .replace(/\byoung families\b/gi, "local homeowners")
        .replace(/\blast chance\b/gi, "when you are ready") ??
      "Thinking about selling? Download the local seller preparation checklist.",
  });
}
