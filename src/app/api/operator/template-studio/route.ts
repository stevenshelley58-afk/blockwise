import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { studioQueue } from "@/lib/adstudio/v2/studio-queue";

// GET /api/operator/template-studio — the QA queue: every v2 template with
// status, intent coverage, residual summary and restyle state.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ templates: studioQueue() });
}
