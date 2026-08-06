// Fixture asset bytes for the render-parity harness (dev only).
//
// Serves files out of tests/fixtures/adstudio-v2/public so the browser side
// can decode the exact same plate/patch/slot bytes the node renderer reads.
// Path-traversal is refused; production returns 404.

import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  if (!path || path.includes("..") || !path.startsWith("/")) {
    return new NextResponse("bad path", { status: 400 });
  }

  const root = join(process.cwd(), "tests", "fixtures", "adstudio-v2", "public");
  const absolute = normalize(join(root, path.replace(/^\//, "")));
  if (!absolute.startsWith(root)) {
    return new NextResponse("bad path", { status: 400 });
  }

  try {
    const bytes = await readFile(absolute);
    const extension = absolute.slice(absolute.lastIndexOf("."));
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: { "content-type": MIME[extension] ?? "application/octet-stream" },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
