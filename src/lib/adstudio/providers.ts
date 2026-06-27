import {
  googleAssetPackSchema,
  googleSearchPackSchema,
  metaLeadAdPackSchema,
  type GoogleAssetPack,
  type GoogleSearchPack,
  type MetaLeadAdPack,
} from "./types.ts";

export type ProviderCapabilities = {
  structuredJson?: boolean;
  toolCalling?: boolean;
  longContext?: boolean;
  visionInput?: boolean;
  textToImage?: boolean;
  imageToImage?: boolean;
  inpainting?: boolean;
  multiReference?: boolean;
  transparentBackground?: boolean;
  seedControl?: boolean;
  screenshotAnalysis?: boolean;
  ocr?: boolean;
};

export type TextProviderRequest = {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schemaName: ProviderSchemaName;
  /**
   * Optional image (a `data:` URL or absolute http(s) URL) attached to the final
   * user message for vision-capable models. Ignored by text-only providers.
   */
  imageUrl?: string;
};

export type TextProviderResponse = {
  json: unknown;
  rawText: string;
  usage: Record<string, number>;
  providerMetadata: Record<string, unknown>;
};

export type ImageProviderRequest = {
  prompt: string;
  negativePrompt?: string;
  referenceAssets: string[];
  aspectRatio: string;
  stylePreset: string;
  seed?: number;
  signal?: AbortSignal;
  /** When true, the provider must actually consume referenceAssets as image input. */
  requiresReferenceAssets?: boolean;
  /**
   * Optional mask (a `data:` URL) for reference-based edits. Transparent pixels
   * mark the region the model may repaint (the outpaint margin); opaque pixels
   * are preserved. Honoured by providers that support inpainting; ignored by the
   * rest. The mask is applied to the first reference asset.
   */
  maskImage?: string;
};

export type ImageProviderResponse = {
  assetUrl: string;
  seed: number;
  model: string;
  providerMetadata: Record<string, unknown>;
};

export type VisionProviderRequest = {
  images: string[];
  task: "brand_extraction" | "layout_analysis" | "compliance_review";
};

export type VisionProviderResponse = {
  json: unknown;
  confidence: number;
};

export type TextProviderAdapter = {
  providerName: string;
  providerType: "text_generation";
  capabilities: ProviderCapabilities;
  generate(input: TextProviderRequest): Promise<TextProviderResponse>;
};

export type ImageProviderAdapter = {
  providerName: string;
  providerType: "image_generation";
  capabilities: ProviderCapabilities;
  generate(input: ImageProviderRequest): Promise<ImageProviderResponse>;
};

export type VisionProviderAdapter = {
  providerName: string;
  providerType: "vision_analysis";
  capabilities: ProviderCapabilities;
  analyse(input: VisionProviderRequest): Promise<VisionProviderResponse>;
};

export type ProviderSchemaName = "metaLeadAdPack" | "googleSearchPack" | "googleAssetPack";

export type ProviderValidationResult =
  | {
      ok: true;
      value: MetaLeadAdPack | GoogleSearchPack | GoogleAssetPack;
      repaired: boolean;
      error?: never;
    }
  | {
      ok: false;
      value?: never;
      repaired: boolean;
      error: string;
    };

type ParsedProviderValidationResult =
  | {
      ok: true;
      value: MetaLeadAdPack | GoogleSearchPack | GoogleAssetPack;
      error?: never;
    }
  | {
      ok: false;
      value?: never;
      error: string;
    };

export function validateProviderJsonOutput(input: {
  rawText: string;
  schemaName: ProviderSchemaName;
  repair?: (rawText: string, error: string) => string;
}): ProviderValidationResult {
  const first = parseAndValidate(input.rawText, input.schemaName);

  if (first.ok) {
    return {
      ok: true,
      value: first.value,
      repaired: false,
    };
  }

  if (!input.repair) {
    return {
      ok: false,
      repaired: false,
      error: first.error,
    };
  }

  const repairedText = input.repair(input.rawText, first.error);
  const repaired = parseAndValidate(repairedText, input.schemaName);

  if (!repaired.ok) {
    return {
      ok: false,
      repaired: true,
      error: repaired.error,
    };
  }

  return {
    ok: true,
    value: repaired.value,
    repaired: true,
  };
}

export function createDeterministicTextProvider(): TextProviderAdapter {
  return {
    providerName: "deterministic_local",
    providerType: "text_generation",
    capabilities: {
      structuredJson: true,
      longContext: true,
    },
    async generate(input) {
      const prompt = input.messages.map((message) => message.content).join("\n");
      const suburb = prompt.match(/\b(?:in|for)\s+([A-Z][A-Za-z -]+)\b/)?.[1] ?? "your suburb";
      const json =
        input.schemaName === "metaLeadAdPack"
          ? {
              platform: "meta",
              specialAdCategory: "housing",
              primaryText: [`Thinking about selling in ${suburb}? Download a practical seller preparation checklist.`],
              headlines: ["Seller checklist"],
              descriptions: ["Free guide for local sellers."],
              cta: "LEARN_MORE",
              leadForm: {
                headline: "Get the seller checklist",
                questions: ["What suburb is your property in?", "When are you considering selling?"],
                privacyPolicyUrl: "https://example.com/privacy",
                thankYouScreen: {
                  title: "Your checklist is on the way",
                  body: "We will send the guide and practical local selling tips.",
                },
              },
            }
          : {};

      return {
        json,
        rawText: JSON.stringify(json),
        usage: { inputTokens: prompt.length, outputTokens: JSON.stringify(json).length },
        providerMetadata: { deterministic: true },
      };
    },
  };
}

export function createDeterministicImageProvider(): ImageProviderAdapter {
  return {
    providerName: "deterministic_local",
    providerType: "image_generation",
    capabilities: {
      textToImage: true,
      seedControl: true,
    },
    async generate(input) {
      return {
        assetUrl: `asset://generated/${slugify(input.stylePreset)}-${input.aspectRatio.replace(":", "x")}.svg`,
        seed: input.seed ?? 1,
        model: "deterministic-svg",
        providerMetadata: { prompt: input.prompt },
      };
    },
  };
}

export function createDeterministicVisionProvider(): VisionProviderAdapter {
  return {
    providerName: "deterministic_local",
    providerType: "vision_analysis",
    capabilities: {
      screenshotAnalysis: true,
      ocr: true,
    },
    async analyse(input) {
      return {
        json: {
          task: input.task,
          imageCount: input.images.length,
          styleTags: ["professional", "minimal"],
        },
        confidence: 0.82,
      };
    },
  };
}

function parseAndValidate(rawText: string, schemaName: ProviderSchemaName): ParsedProviderValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      error: "Provider output was not valid JSON.",
    };
  }

  const schema =
    schemaName === "metaLeadAdPack"
      ? metaLeadAdPackSchema
      : schemaName === "googleSearchPack"
        ? googleSearchPackSchema
        : googleAssetPackSchema;
  const result = schema.safeParse(parsed);

  if (!result.success) {
    return {
      ok: false,
      error: `Provider output did not match ${schemaName}: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    };
  }

  return {
    ok: true,
    value: result.data,
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
