import { NextResponse, type NextRequest } from "next/server";

import { builtInAdStudioTemplates } from "@/lib/adstudio";
import { requireApiWorkspace } from "@/lib/auth/api-guards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  return NextResponse.json({
    templates: builtInAdStudioTemplates(),
    source: "self_contained_gallery",
  });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  return NextResponse.json({ error: "Template gallery is read-only." }, { status: 405 });
}
