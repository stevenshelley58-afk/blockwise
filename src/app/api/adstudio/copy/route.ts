import { NextResponse, type NextRequest } from "next/server";

import {
  generateAdStudioCopy,
  type AdStudioCopyRequestBody,
} from "@/lib/adstudio/copy-generation";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<AdStudioCopyRequestBody>(request);

  try {
    const sourceImageUrl = await resolveAdStudioImageForModel(
      access.supabase,
      access.access.workspaceId,
      body.sourceImageUrl,
    );
    const result = await generateAdStudioCopy({
      ...body,
      sourceImageUrl,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Copy generation failed." },
      { status: 502 },
    );
  }
}
