import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import {
  approveTemplate,
  runBake,
  runFidelityCheck,
  runRestyle,
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

  if (action === "bake" || action === "unbake") {
    const key = new URL(request.url).searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    try {
      const result = await runBake(doc, key, action === "bake");
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Bake failed." }, { status: 422 });
    }
  }

  // Restyle (D5): deterministic palette remap + sample render, headless.
  if (action === "restyle") {
    try {
      const result = await runRestyle(doc);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Restyle failed." }, { status: 422 });
    }
  }

  if (action === "stress") {
    try {
      const { renderAdDocToPng } = await import("@/lib/adstudio/v2/render/server.ts");
      const editable = doc.inputs.text.filter((input) => !doc.exactness.bakedTextKeys.includes(input.key));
      const variants: Array<[string, Record<string, string>]> = [
        ["longest", Object.fromEntries(editable.map((input) => [input.key, input.sample.slice(0, input.maxLength)]))],
        ["one-char", Object.fromEntries(editable.map((input) => [input.key, "W"]))],
      ];
      const renders: Array<{ name: string; dataUrl: string }> = [];
      for (const [name, textValues] of variants) {
        try {
          const png = await renderAdDocToPng(doc, {
            schema: "adstudio.instance.v2",
            templateId: doc.id,
            templateHash: "0".repeat(64),
            format: doc.formats.feed.format,
            values: { images: {}, text: textValues },
            overrides: [],
          }, doc.formats.feed.format);
          renders.push({ name, dataUrl: `data:image/png;base64,${png.toString("base64")}` });
        } catch (error) {
          renders.push({ name: `${name} (refused: ${(error as Error).name})`, dataUrl: "" });
        }
      }
      return NextResponse.json({ renders });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Stress render failed." }, { status: 422 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
