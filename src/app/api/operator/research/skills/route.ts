import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { listHermesSkills } from "@/lib/operator/hermes-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const skills = await listHermesSkills();
  return NextResponse.json({ skills });
}
