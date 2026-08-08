import { NextResponse, type NextRequest } from "next/server";

import { resolveReadyTemplateV2 } from "@/lib/adstudio/v2/template-resolver";

// GET /api/adstudio/templates-v2/[id] — public read of a repo-versioned v2
// template doc (gallery data is public by definition). Only human-approved
// `ready` templates are public; absent and not-yet-approved docs both 404.
// Schema failures remain a 500 because they are deploy bugs, like the gate.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const { id } = await routeContext.params;
  try {
    const template = resolveReadyTemplateV2(id);
    if (!template) return NextResponse.json({ error: "Unknown template." }, { status: 404 });
    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Template failed validation." },
      { status: 500 },
    );
  }
}
