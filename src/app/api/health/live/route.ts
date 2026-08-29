import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Process liveness only. Readiness belongs to /api/health. */
export function GET() {
  return NextResponse.json({ app: "blockwise", status: "alive" });
}
