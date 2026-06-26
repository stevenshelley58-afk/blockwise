import { NextResponse, type NextRequest } from "next/server";

import { ADSTUDIO_TEMPLATE_RESET_MESSAGE, builtInAdStudioTemplates } from "@/lib/adstudio";
import { requireApiWorkspace } from "@/lib/auth/api-guards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  return NextResponse.json({
    templates: builtInAdStudioTemplates(),
    source: "template_reset",
    message: ADSTUDIO_TEMPLATE_RESET_MESSAGE,
  });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  return NextResponse.json({ error: ADSTUDIO_TEMPLATE_RESET_MESSAGE }, { status: 410 });
}
