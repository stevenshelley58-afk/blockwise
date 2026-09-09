import { NextResponse, type NextRequest } from "next/server";

import { safeBearerMatches } from "@/lib/adstudio/template-factory-contract";
import { consumeFactoryReceipt, resolveTemplateFactoryConfig } from "@/lib/adstudio/template-factory-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> | { token: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  let config: ReturnType<typeof resolveTemplateFactoryConfig>;
  try { config = resolveTemplateFactoryConfig(); }
  catch { return NextResponse.json({ error: "Template factory is unavailable." }, { status: 503 }); }
  if (!safeBearerMatches(request.headers.get("authorization"), config.resultPullToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { token } = await Promise.resolve(context.params);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(token)) return NextResponse.json({ error: "Receipt is invalid." }, { status: 404 });
  try {
    const receipt = await consumeFactoryReceipt(config, token);
    if (!receipt) return NextResponse.json({ error: "Receipt is expired, used, or invalid." }, { status: 410 });
    return new NextResponse(receipt.bytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(receipt.bytes.byteLength),
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "x-template-factory-content-sha256": receipt.content_hash,
      },
    });
  } catch {
    return NextResponse.json({ error: "Receipt artifact is unavailable." }, { status: 503 });
  }
}
