import { NextResponse, type NextRequest } from "next/server";

import {
  generateAdStudioCopy,
  type AdStudioCopyRequestBody,
} from "@/lib/adstudio/copy-generation";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<AdStudioCopyRequestBody>(request);

  try {
    const result = await generateAdStudioCopy({
      ...body,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI copy generation failed." },
      { status: 502 },
    );
  }
}
