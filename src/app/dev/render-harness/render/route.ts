// Server-side reference renders for the render-parity harness (dev only).
//
// GET /dev/render-harness/render?fixture=<id>&format=<4:5|9:16>[&instance=feed|story]
// → PNG bytes from renderAdDocToPng (THE canonical pixel producer). The
// parity spec compares these against the browser's own render of the same
// doc: byte-identical outside text boxes, SSIM ≥ 0.97 inside.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { renderAdDocToPng } from "@/lib/adstudio/v2/render/server.ts";
import type { AdDocInstance, AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const fixture = searchParams.get("fixture");
  const format = searchParams.get("format");
  const instanceName = searchParams.get("instance");

  if (!fixture?.startsWith("meta-fixture-") || (format !== "4:5" && format !== "9:16")) {
    return new NextResponse("bad request", { status: 400 });
  }

  const repoRoot = process.cwd();
  const fixtureRoot = join(repoRoot, "tests", "fixtures", "adstudio-v2");
  const doc = JSON.parse(readFileSync(join(fixtureRoot, fixture, "template.json"), "utf8")) as AdTemplateDocV2;
  let instance: AdDocInstance | null = null;
  if (instanceName === "feed" || instanceName === "story") {
    instance = JSON.parse(
      readFileSync(join(fixtureRoot, fixture, `instance-${instanceName}.json`), "utf8"),
    ) as AdDocInstance;
  }

  const png = await renderAdDocToPng(doc, instance, format, {
    repoRoot: fixtureRoot,
    fontsDir: join(repoRoot, "public", "fonts", "adstudio"),
    resolveSlotSrc: async () =>
      readFileSync(join(fixtureRoot, "public", "slots", "photo-landscape.png")),
  });

  return new NextResponse(png as unknown as BodyInit, {
    headers: { "content-type": "image/png" },
  });
}
