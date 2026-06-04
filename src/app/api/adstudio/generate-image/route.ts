import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiImageProvider, generateMixedImageVariantsInParallel } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateImageBody = {
  prompt?: string;
  aspectRatio?: string;
  stylePreset?: string;
  referenceAssets?: string[];
  variantCount?: number;
  /** Brand kit visual context — appended so scenes match the brand look. */
  brand?: {
    palette?: string[];
    styleTags?: string[];
    imageTreatment?: string;
  };
};

function withBrandContext(prompt: string, brand: GenerateImageBody["brand"]): string {
  if (!brand) return prompt;
  const parts = [prompt];
  if (brand.palette?.length) {
    parts.push(`Colour direction: lean into ${brand.palette.slice(0, 3).join(", ")} tones.`);
  }
  if (brand.styleTags?.length) {
    parts.push(`Visual style: ${brand.styleTags.join(", ")}.`);
  }
  if (brand.imageTreatment) {
    parts.push(`Treatment: ${brand.imageTreatment}.`);
  }
  return parts.join("\n");
}

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
    const imageInput = {
      prompt: withBrandContext(body.prompt.trim(), body.brand),
      referenceAssets: body.referenceAssets ?? [],
      aspectRatio: body.aspectRatio ?? "1:1",
      stylePreset: body.stylePreset ?? "real_estate_photography",
    };

    if ((body.variantCount ?? 1) > 1) {
      const variants = await generateMixedImageVariantsInParallel(imageInput);
      const first = variants.find((variant) => variant.assetUrl);

      if (!first) {
        return NextResponse.json({ error: "No image was returned by the providers." }, { status: 502 });
      }

      return NextResponse.json({
        image: first.assetUrl,
        model: first.model,
        variants: variants.map((variant, index) => ({
          image: variant.assetUrl,
          model: variant.model,
          provider: variant.providerMetadata.provider,
          index,
        })),
      });
    }

    const provider = createOpenAiImageProvider();
    const result = await provider.generate(imageInput);

    if (!result.assetUrl) {
      return NextResponse.json({ error: "No image was returned by the provider." }, { status: 502 });
    }

    return NextResponse.json({ image: result.assetUrl, model: result.model });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
