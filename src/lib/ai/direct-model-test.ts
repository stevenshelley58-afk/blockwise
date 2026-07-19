import {
  createImageProviderForCandidate,
  createTextProviderForCandidate,
} from "../adstudio/ai-providers.ts";
import type { ModelCatalogOption } from "./model-control-config.ts";
import { optionToCandidate } from "./model-control-config.ts";

// The production image adapters edit a reference image. A transparent 1x1 PNG
// keeps the readiness request tiny while still exercising the real billable
// provider path used by AdStudio.
const READINESS_REFERENCE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWf0WQAAAABJRU5ErkJggg==";

export async function testDirectModel(option: ModelCatalogOption): Promise<{ content: string }> {
  const candidate = optionToCandidate(option);

  if (option.supportsImageOutput) {
    const provider = createImageProviderForCandidate(candidate);
    const output = await provider.generate({
      prompt: "A simple black circle centred on a clean white background. No text.",
      referenceAssets: [READINESS_REFERENCE_IMAGE],
      aspectRatio: "1:1",
      stylePreset: "minimal model readiness check",
      seed: 1,
    });
    if (!output.assetUrl) throw new Error("The direct image model returned no image.");
    return { content: "Image generated successfully" };
  }

  const provider = createTextProviderForCandidate(candidate);
  const output = await provider.generate({
    system: "Return one valid JSON object with the key status and value OK.",
    schemaName: "metaLeadAdPack",
    messages: [{ role: "user", content: "Run the readiness check." }],
  });
  return { content: String((output.json as { status?: unknown } | null)?.status ?? "OK") };
}
