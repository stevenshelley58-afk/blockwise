import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { readSourceImageBytes } from "@/lib/operator/template-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const image = readSourceImageBytes(decodeURIComponent(id));
  if (!image) {
    return NextResponse.json({ error: "Source image not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.contentType,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
