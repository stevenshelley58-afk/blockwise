import {
  adStudioTemplateAnalysisSchema,
  adStudioCloneQualityReviewSchema,
  googleAssetPackSchema,
  googleSearchPackSchema,
  metaLeadAdPackSchema,
  type GoogleAssetPack,
  type AdStudioTemplateAnalysis,
  type AdStudioCloneQualityReview,
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
  signal?: AbortSignal;
};

export type TextProviderResponse = {
  json: unknown;
  rawText: string;
  usage: ProviderUsage;
  providerMetadata: Record<string, unknown>;
};

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  imageUnits?: number;
  actualCostUsd?: number;
  providerRequestId?: string;
  complete?: boolean;
};

export type ProviderPricingSnapshot = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  imageUsdPerUnit: number;
  currency?: "USD";
  inputTokenBasis?: "per_million_tokens";
  outputTokenBasis?: "per_million_tokens";
  imageBasis?: "per_output_image";
  source?: "persisted" | "default";
  snapshotId?: string | null;
};

export type ProviderAccountingContext = {
  model: string;
  modelProfileVersionId?: string | null;
  pricingSnapshotId?: string | null;
  pricing: ProviderPricingSnapshot;
};

export class ProviderRequestError extends Error {
  readonly requestSubmitted: boolean;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly usage?: ProviderUsage;
  readonly providerRequestId?: string | null;

  constructor(
    message: string,
    options: {
      requestSubmitted: boolean;
      retryable: boolean;
      fallbackEligible?: boolean;
      usage?: ProviderUsage;
      providerRequestId?: string | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderRequestError";
    this.requestSubmitted = options.requestSubmitted;
    this.retryable = options.retryable;
    this.fallbackEligible = options.fallbackEligible ?? options.retryable;
    this.usage = options.usage;
    this.providerRequestId = options.providerRequestId;
  }
}

export async function fetchProviderRequest(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  evidence: { providerRequestId?: string | null; usage?: ProviderUsage } = {},
): Promise<Response> {
  if (init.signal?.aborted) {
    throw new ProviderRequestError("Provider request was cancelled before dispatch.", {
      requestSubmitted: false,
      retryable: false,
      cause: init.signal.reason,
    });
  }

  try {
    return await fetchImpl(input, init);
  } catch (cause) {
    const aborted = init.signal?.aborted === true
      || (typeof cause === "object" && cause !== null && "name" in cause && cause.name === "AbortError");
    throw new ProviderRequestError(
      aborted ? "Provider request was cancelled after dispatch." : "Provider transport failed after dispatch.",
      {
        requestSubmitted: true,
        retryable: !aborted,
        providerRequestId: evidence.providerRequestId,
        usage: { ...evidence.usage, complete: false },
        cause,
      },
    );
  }
}

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
  usage: ProviderUsage;
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
  accounting?: ProviderAccountingContext;
  generate(input: TextProviderRequest): Promise<TextProviderResponse>;
};

export type ImageProviderAdapter = {
  providerName: string;
  providerType: "image_generation";
  capabilities: ProviderCapabilities;
  accounting?: ProviderAccountingContext;
  generate(input: ImageProviderRequest): Promise<ImageProviderResponse>;
};

export type VisionProviderAdapter = {
  providerName: string;
  providerType: "vision_analysis";
  capabilities: ProviderCapabilities;
  analyse(input: VisionProviderRequest): Promise<VisionProviderResponse>;
};

export type ProviderSchemaName = "metaLeadAdPack" | "googleSearchPack" | "googleAssetPack" | "adStudioTemplateAnalysis" | "adStudioCloneQualityReview";

export type ProviderValidationResult =
  | {
      ok: true;
      value: MetaLeadAdPack | GoogleSearchPack | GoogleAssetPack | AdStudioTemplateAnalysis | AdStudioCloneQualityReview;
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
      value: MetaLeadAdPack | GoogleSearchPack | GoogleAssetPack | AdStudioTemplateAnalysis | AdStudioCloneQualityReview;
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
        usage: { inputTokens: prompt.length, outputTokens: JSON.stringify(json).length, complete: true },
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
        usage: { imageUnits: 1, complete: true },
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
        : schemaName === "googleAssetPack"
          ? googleAssetPackSchema
          : schemaName === "adStudioTemplateAnalysis"
            ? adStudioTemplateAnalysisSchema
            : adStudioCloneQualityReviewSchema;
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
