import { NextResponse, type NextRequest } from "next/server";

import { ADSTUDIO_TEMPLATE_RESET_MESSAGE } from "@/lib/adstudio";
import { requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  return NextResponse.json(
    {
      error: ADSTUDIO_TEMPLATE_RESET_MESSAGE,
      photoPrep: { status: "skipped", readyFormats: [], pendingFormats: [] },
    },
    { status: 410 },
  );
}
