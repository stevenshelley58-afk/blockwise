import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CANDIDATES_DIR = path.join(process.cwd(), "meta_ad_candidates");

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  // Prevent path traversal
  if (/[.]{2,}/.test(filePath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const fullPath = path.join(CANDIDATES_DIR, filePath);
  if (!fullPath.startsWith(CANDIDATES_DIR)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  try {
    const data = await readFile(fullPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
