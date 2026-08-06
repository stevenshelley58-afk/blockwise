import { NextResponse } from "next/server";

import { renderAdDocToPng } from "@/lib/adstudio/v2/render/server.ts";
import { loadTemplateV2 } from "@/lib/adstudio/v2/template-resolver.ts";

// F0 acceptance #4: proves the napi-rs/canvas backend renders on the Vercel
// Node runtime. Gated by ADSTUDIO_RENDER_SMOKE (Preview env only; never set
// in production — canonical pixels ship through /doc, not here).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.ADSTUDIO_RENDER_SMOKE !== "1") {
    return NextResponse.json({ error: "Render smoke is disabled." }, { status: 404 });
  }
  // Any ready-or-draft template proves the backend; fall back to the first
  // gallery entry so the smoke works before QA produces ready templates.
  const started = Date.now();
  const id = process.env.ADSTUDIO_RENDER_SMOKE_TEMPLATE ?? "meta-feed-018";
  const doc = loadTemplateV2(id);
  if (!doc) return NextResponse.json({ error: `no template ${id}` }, { status: 404 });

  const instance = {
    schema: "adstudio.instance.v2" as const,
    templateId: doc.id,
    templateHash: "0".repeat(64),
    format: "4:5" as const,
    values: {
      images: {},
      text: Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample])),
    },
    overrides: [],
  };
  const png = await renderAdDocToPng(doc, instance, "4:5");
  return NextResponse.json({
    ok: true,
    template: doc.id,
    bytes: png.length,
    width: 1080,
    height: 1350,
    ms: Date.now() - started,
  });
}
