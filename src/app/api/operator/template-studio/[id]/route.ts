import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import {
  approveTemplate,
  runFidelityCheck,
  studioWritesAllowed,
  writeTemplateDoc,
} from "@/lib/adstudio/v2/studio";
import { loadTemplateV2 } from "@/lib/adstudio/v2/template-resolver";
import { templateDocV2Schema } from "@/lib/adstudio/v2/template-doc";

// Template Studio API (§5.2): GET doc; PATCH doc; POST check; POST approve.
// Writes go to the working tree — DEV-ONLY (repo-versioned docs ship via git;
// production Studio is read-only + review).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const doc = loadTemplateV2(id);
    if (!doc) return NextResponse.json({ error: "Unknown template." }, { status: 404 });
    return NextResponse.json(doc);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Broken template." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  if (!studioWritesAllowed()) {
    return NextResponse.json({ error: "Template docs ship via git; production Studio is read-only." }, { status: 403 });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = templateDocV2Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `schema: ${parsed.error.issues[0]?.message}` }, { status: 422 });
  }
  if (parsed.data.id !== id) {
    return NextResponse.json({ error: "doc id does not match the route" }, { status: 422 });
  }
  writeTemplateDoc(id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  if (!studioWritesAllowed()) {
    return NextResponse.json({ error: "Template docs ship via git; production Studio is read-only." }, { status: 403 });
  }
  const { id } = await context.params;
  const action = new URL(request.url).searchParams.get("action") ?? "check";
  const doc = loadTemplateV2(id);
  if (!doc) return NextResponse.json({ error: "Unknown template." }, { status: 404 });

  if (action === "check") {
    try {
      const check = await runFidelityCheck(doc);
      doc.exactness = { ...doc.exactness, residuals: check.residuals };
      writeTemplateDoc(id, doc);
      return NextResponse.json(check);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Check failed." }, { status: 422 });
    }
  }

  if (action === "approve") {
    const body = (await request.json().catch(() => null)) as { confirmed?: boolean } | null;
    try {
      const result = await approveTemplate(doc, auth.email, Boolean(body?.confirmed));
      if (!result.ok) return NextResponse.json(result, { status: 422 });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json({ ok: false, problems: [error instanceof Error ? error.message : "Approve failed."] }, { status: 422 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
