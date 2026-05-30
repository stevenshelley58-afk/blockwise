import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiImageProvider } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateImageBody = {
  prompt?: string;
  aspectRatio?: string;
  stylePreset?: string;
  referenceAssets?: string[];
};

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<GenerateImageBody>(request);

  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json({ error: "An image prompt is required." }, { status: 400 });
  }

  try {
    const provider = createOpenAiImageProvider();
    const result = await provider.generate({
      prompt: body.prompt.trim(),
      referenceAssets: body.referenceAssets ?? [],
      aspectRatio: body.aspectRatio ?? "1:1",
      stylePreset: body.stylePreset ?? "real_estate_photography",
    });

    if (!result.assetUrl) {
      return NextResponse.json({ error: "No image was returned by the provider." }, { status: 502 });
    }

    return NextResponse.json({ image: result.assetUrl, model: result.model });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
