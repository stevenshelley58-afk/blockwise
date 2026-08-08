import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { loadTemplateV2 } from "@/lib/adstudio/v2/template-resolver";
import { resolveSourceAdPath, sourceAdContentType } from "@/lib/adstudio/source-ad-path";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SOURCE_ARCHIVE_DIR = join(process.cwd(), "meta_ad_candidates");

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
  const sourceFile = doc.provenance.sourceAd.file;
  const path = resolveSourceAdPath(SOURCE_ARCHIVE_DIR, sourceFile);
  const contentType = sourceAdContentType(sourceFile);
  if (!path || !contentType || !existsSync(path)) {
    return NextResponse.json({ error: "Source file missing from the archive." }, { status: 404 });
  }
  const bytes = readFileSync(path);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}
