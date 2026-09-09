import { NextResponse, type NextRequest } from "next/server";

import {
  generateAdStudioCopy,
  generateAdStudioTemplateCopy,
  type AdStudioCopyRequestBody,
  type AdStudioTemplateCopyFieldSpec,
} from "@/lib/adstudio/copy-generation";
import { publicAdStudioGenerationError } from "@/lib/adstudio/generation-error";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CopyRouteBody = Omit<AdStudioCopyRequestBody, "mode"> & {
  mode?: AdStudioCopyRequestBody["mode"] | "templateFields";
  /** Template on-image field specs — required when mode is "templateFields". */
  templateFields?: AdStudioTemplateCopyFieldSpec[];
};

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<CopyRouteBody>(request);

  try {
    const sourceImageUrl = await resolveAdStudioImageForModel(
      access.supabase,
      access.access.workspaceId,
      body.sourceImageUrl,
    );

    if (body.mode === "templateFields") {
      if (!body.brief?.trim()) {
        return NextResponse.json({ error: "A brief is required for template copy." }, { status: 400 });
      }
      if (!Array.isArray(body.templateFields) || body.templateFields.length === 0) {
        return NextResponse.json({ error: "templateFields is required." }, { status: 400 });
      }
      const result = await generateAdStudioTemplateCopy({
        workspaceId: access.access.workspaceId,
        userId: access.access.userId,
        description: body.brief,
        fields: body.templateFields,
        sourceImageUrl,
        context: body.context,
      });
      return NextResponse.json(result);
    }

    const result = await generateAdStudioCopy({
      ...body,
      mode: body.mode,
      sourceImageUrl,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    // Never surface raw provider/cascade errors (they can include model names,
    // quota text, and API vocabulary) — log for operators, sanitise for users.
    console.error("adstudio copy generation failed", error);
    return NextResponse.json(
      { error: publicAdStudioGenerationError(error) },
      { status: 502 },
    );
  }
}
