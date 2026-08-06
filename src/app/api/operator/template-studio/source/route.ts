import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { loadTemplateV2 } from "@/lib/adstudio/v2/template-resolver";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Serves the provenance source ad for the Studio diff view (operator-only).
// The source is the legal provenance archive; operators may see it, customers
// never do.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  const doc = loadTemplateV2(id);
  if (!doc?.provenance.sourceAd.file) {
    return NextResponse.json({ error: "No source file recorded." }, { status: 404 });
  }
  const path = join(process.cwd(), "meta_ad_candidates", doc.provenance.sourceAd.file);
  if (!existsSync(path)) {
    return NextResponse.json({ error: "Source file missing from the archive." }, { status: 404 });
  }
  const bytes = readFileSync(path);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
