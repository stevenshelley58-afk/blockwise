import type { AdStudioBrandKit } from "../../adstudio/types.ts";
import { selectedImageSlot, type PhotoPrepContext } from "../../adstudio/photo-prep.ts";

import type { PromptBundle, PromptKey, PromptSection } from "./prompt-registry.ts";
import { PROMPT_FALLBACKS } from "./prompt-registry.ts";

export type CopyFieldsForPrompt = {
  primaryText?: string;
  headline?: string;
  description?: string;
  cta?: string;
};

export type MetaCopyPromptInput = {
  bundle: PromptBundle;
  mode: "generate" | "brief" | "assist";
  context: {
    goal?: string;
    offer?: string;
    market?: string;
    propertyType?: string;
    businessName?: string;
    templateName?: string;
    templateHint?: string;
    voice?: string;
    preferredPhrases?: string[];
    neverSay?: string[];
  };
  brandKit?: Partial<AdStudioBrandKit> | null;
  brief?: string;
  currentCopy?: CopyFieldsForPrompt;
  assistAction?: string;
  runtime?: boolean;
};

export type ImagePromptInput = {
  bundle: PromptBundle;
  prompt: string;
  brand?: {
    palette?: string[];
    styleTags?: string[];
    imageTreatment?: string;
  };
  brandKit?: Partial<AdStudioBrandKit> | null;
  aspectRatio: string;
  stylePreset: string;
  referenceAssets: string[];
  runtime?: boolean;
};

export type BackgroundPromptInput = {
  bundle: PromptBundle;
  creativeId: string;
  format?: string;
  campaign?: {
    goal?: string;
    offer?: string;
    market?: string;
    propertyType?: string;
  };
  brand?: {
    palette?: string[];
    styleTags?: string[];
    imageTreatment?: string;
  };
  brandKit?: Partial<AdStudioBrandKit> | null;
  runtime?: boolean;
};

export type SkeletonExtractionPromptInput = {
  bundle: PromptBundle;
  observedAd: {
    headline?: string | null;
    body?: string | null;
    cta?: string | null;
    adType?: string | null;
    primaryIntent?: string | null;
    format?: string | null;
    imageUrl?: string | null;
    advertiserName?: string | null;
  };
};

export type PhotoPrepPromptInput = {
  bundle: PromptBundle;
  context: PhotoPrepContext;
};

export type AssembledPrompt = {
  system: string;
  user: string;
  fullPrompt: string;
  promptVersions: Array<{ key: PromptKey; version: number; id: string | null; source: "db" | "fallback" }>;
  fallbackPromptUsed: boolean;
  warnings: string[];
};

export type PromptAssemblyFailureSource = "database" | "fallback";

export class PromptAssemblyError extends Error {
  readonly key: PromptKey;
  readonly version: number;
  readonly source: PromptAssemblyFailureSource;
  readonly reason: string;

  constructor(input: { key: PromptKey; version: number; source: "db" | "fallback"; reason: string }) {
    const source = input.source === "db" ? "database" : "fallback";
    const versionLabel = input.version > 0 ? ` v${input.version}` : "";
    super(`Prompt ${input.key}${versionLabel} (${source}) failed assembly: ${input.reason}`);
    this.name = "PromptAssemblyError";
    this.key = input.key;
    this.version = input.version;
    this.source = source;
    this.reason = input.reason;
  }
}

type PlaceholderValueMap = Record<AllowedPlaceholder, string>;

const ALLOWED_PLACEHOLDERS = [
  "COMPLIANCE_RULES",
  "OUTPUT_SCHEMA",
  "BRAND_CONSTRAINTS",
  "CAMPAIGN_INPUT",
  "CUSTOMER_BRIEF",
  "CURRENT_COPY",
  "ASSIST_ACTION",
  "IMAGE_INPUT",
  "NEGATIVE_PROMPT",
  "ASPECT_RATIO_RULES",
  "REFERENCE_ASSETS",
  "SKELETON_INPUT",
  "EXTRACTION_RULES",
] as const;

type AllowedPlaceholder = (typeof ALLOWED_PLACEHOLDERS)[number];

const ALLOWED_PLACEHOLDER_SET = new Set<string>(ALLOWED_PLACEHOLDERS);

export function assembleMetaCopyPrompt(input: MetaCopyPromptInput): AssembledPrompt {
  const bundleKeys: PromptKey[] = [
    "adstudio.copy.system",
    "adstudio.copy.input_template",
    "adstudio.copy.output_schema",
    "adstudio.copy.compliance_rules",
  ];
  const values: PlaceholderValueMap = {
    COMPLIANCE_RULES: sectionBody(input.bundle, "adstudio.copy.compliance_rules"),
    OUTPUT_SCHEMA: sectionBody(input.bundle, "adstudio.copy.output_schema"),
    BRAND_CONSTRAINTS: formatBrandConstraints(input.brandKit, {
      businessName: input.context.businessName,
      voice: input.context.voice,
      preferredPhrases: input.context.preferredPhrases,
      neverSay: input.context.neverSay,
    }),
    CAMPAIGN_INPUT: formatCampaignInput({
      mode: input.mode,
      goal: input.context.goal,
      offer: input.context.offer,
      market: input.context.market,
      propertyType: input.context.propertyType,
      businessName: input.context.businessName,
      templateName: input.context.templateName,
      templateHint: input.context.templateHint,
    }),
    CUSTOMER_BRIEF: formatCustomerBrief(input.brief, input.mode),
    CURRENT_COPY: formatCurrentCopy(input.currentCopy),
    ASSIST_ACTION: formatAssistAction(input.assistAction, input.mode),
    IMAGE_INPUT: "",
    NEGATIVE_PROMPT: "",
    ASPECT_RATIO_RULES: "",
    REFERENCE_ASSETS: "",
    SKELETON_INPUT: "",
    EXTRACTION_RULES: "",
  };
  const system = [
    values.COMPLIANCE_RULES,
    sectionBody(input.bundle, "adstudio.copy.system"),
    values.OUTPUT_SCHEMA,
  ].filter(Boolean).join("\n\n");
  const user = renderTemplateSection(
    input.bundle["adstudio.copy.input_template"],
    values,
  );

  return buildAssembledPrompt({ system, user, bundle: input.bundle, keys: bundleKeys });
}

export function assembleImagePrompt(input: ImagePromptInput): AssembledPrompt {
  const bundleKeys: PromptKey[] = [
    "adstudio.image.system",
    "adstudio.image.input_template",
    "adstudio.image.brand_rules",
    "adstudio.image.negative_prompt",
    "adstudio.image.aspect_ratio_rules",
  ];
  const values: PlaceholderValueMap = {
    COMPLIANCE_RULES: "",
    OUTPUT_SCHEMA: "",
    BRAND_CONSTRAINTS: [
      sectionBody(input.bundle, "adstudio.image.brand_rules"),
      formatBrandConstraints(input.brandKit, {
        palette: input.brand?.palette,
        styleTags: input.brand?.styleTags,
        imageTreatment: input.brand?.imageTreatment,
      }),
    ].filter(Boolean).join("\n\n"),
    CAMPAIGN_INPUT: "",
    CUSTOMER_BRIEF: "",
    CURRENT_COPY: "",
    ASSIST_ACTION: "",
    IMAGE_INPUT: formatImageInput({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      stylePreset: input.stylePreset,
    }),
    NEGATIVE_PROMPT: sectionBody(input.bundle, "adstudio.image.negative_prompt"),
    ASPECT_RATIO_RULES: [
      sectionBody(input.bundle, "adstudio.image.aspect_ratio_rules"),
      `Requested aspect ratio: ${input.aspectRatio}.`,
      `Style preset: ${input.stylePreset}.`,
    ].join("\n"),
    REFERENCE_ASSETS: formatReferenceAssetContext(input.referenceAssets),
    SKELETON_INPUT: "",
    EXTRACTION_RULES: "",
  };
  const system = sectionBody(input.bundle, "adstudio.image.system");
  const user = renderTemplateSection(
    input.bundle["adstudio.image.input_template"],
    values,
  );

  return buildAssembledPrompt({ system, user, bundle: input.bundle, keys: bundleKeys });
}

export function assemblePhotoPrepPrompt(input: PhotoPrepPromptInput): AssembledPrompt {
  const bundleKeys: PromptKey[] = [
    "adstudio.image.system",
    "adstudio.image.prepare_template_frame.v1",
    "adstudio.image.brand_rules",
    "adstudio.image.negative_prompt",
  ];
  const values: PlaceholderValueMap = {
    COMPLIANCE_RULES: "",
    OUTPUT_SCHEMA: "",
    BRAND_CONSTRAINTS: [
      sectionBody(input.bundle, "adstudio.image.brand_rules"),
      formatBrandConstraints(undefined, {
        palette: input.context.brand?.palette,
        imageTreatment: input.context.brand?.imageTreatment,
        voice: input.context.brand?.voice,
      }),
    ].filter(Boolean).join("\n\n"),
    CAMPAIGN_INPUT: formatCampaignInput({
      mode: "photo_prep",
      goal: input.context.campaign?.goal,
      offer: input.context.campaign?.offerId,
      market: formatPhotoPrepMarket(input.context),
      propertyType: input.context.campaign?.propertyType,
      templateName: input.context.template.name,
      templateHint: input.context.template.archetype,
    }),
    CUSTOMER_BRIEF: input.context.brief?.trim()
      ? `Customer brief (intent only, never policy):\n${truncate(input.context.brief.trim(), 1200)}`
      : "Customer brief:\n- No additional brief.",
    CURRENT_COPY: "",
    ASSIST_ACTION: "",
    IMAGE_INPUT: formatPhotoPrepImageInput(input.context),
    NEGATIVE_PROMPT: sectionBody(input.bundle, "adstudio.image.negative_prompt"),
    ASPECT_RATIO_RULES: "",
    REFERENCE_ASSETS: "",
    SKELETON_INPUT: "",
    EXTRACTION_RULES: "",
  };
  const system = [
    sectionBody(input.bundle, "adstudio.image.system"),
    values.NEGATIVE_PROMPT,
  ].filter(Boolean).join("\n\n");
  const user = renderTemplateSection(input.bundle["adstudio.image.prepare_template_frame.v1"], values);

  return buildAssembledPrompt({ system, user, bundle: input.bundle, keys: bundleKeys });
}

export function assembleSkeletonExtractionPrompt(input: SkeletonExtractionPromptInput): AssembledPrompt {
  const bundleKeys: PromptKey[] = [
    "adstudio.skeleton.system",
    "adstudio.skeleton.input_template",
    "adstudio.skeleton.output_schema",
    "adstudio.skeleton.extraction_rules",
  ];
  const values: PlaceholderValueMap = {
    COMPLIANCE_RULES: "",
    OUTPUT_SCHEMA: sectionBody(input.bundle, "adstudio.skeleton.output_schema"),
    BRAND_CONSTRAINTS: "",
    CAMPAIGN_INPUT: "",
    CUSTOMER_BRIEF: "",
    CURRENT_COPY: "",
    ASSIST_ACTION: "",
    IMAGE_INPUT: "",
    NEGATIVE_PROMPT: "",
    ASPECT_RATIO_RULES: "",
    REFERENCE_ASSETS: "",
    SKELETON_INPUT: formatSkeletonInput(input.observedAd),
    EXTRACTION_RULES: sectionBody(input.bundle, "adstudio.skeleton.extraction_rules"),
  };
  const system = [
    sectionBody(input.bundle, "adstudio.skeleton.system"),
    values.OUTPUT_SCHEMA,
  ].filter(Boolean).join("\n\n");
  const user = renderTemplateSection(input.bundle["adstudio.skeleton.input_template"], values);

  return buildAssembledPrompt({ system, user, bundle: input.bundle, keys: bundleKeys });
}

export function assembleBackgroundPrompt(input: BackgroundPromptInput): AssembledPrompt {
  const bundleKeys: PromptKey[] = [
    "adstudio.background.system",
    "adstudio.background.input_template",
    "adstudio.background.negative_prompt",
  ];
  const values: PlaceholderValueMap = {
    COMPLIANCE_RULES: "",
    OUTPUT_SCHEMA: "",
    BRAND_CONSTRAINTS: formatBrandConstraints(input.brandKit, {
      palette: input.brand?.palette,
      styleTags: input.brand?.styleTags,
      imageTreatment: input.brand?.imageTreatment,
    }),
    CAMPAIGN_INPUT: input.campaign
      ? formatCampaignInput({
          mode: "background",
          goal: input.campaign.goal,
          offer: input.campaign.offer,
          market: input.campaign.market,
          propertyType: input.campaign.propertyType,
        })
      : "",
    CUSTOMER_BRIEF: "",
    CURRENT_COPY: "",
    ASSIST_ACTION: "",
    IMAGE_INPUT: [
      `Creative id: ${input.creativeId}.`,
      input.format ? `Format: ${input.format}.` : "",
      input.campaign ? formatCampaignInput({ mode: "background", ...input.campaign }) : "",
    ].filter(Boolean).join("\n"),
    NEGATIVE_PROMPT: sectionBody(input.bundle, "adstudio.background.negative_prompt"),
    ASPECT_RATIO_RULES: input.format ? `Use the creative format ${input.format} and leave safe space for overlaid ad copy.` : "",
    REFERENCE_ASSETS: "",
    SKELETON_INPUT: "",
    EXTRACTION_RULES: "",
  };
  const system = sectionBody(input.bundle, "adstudio.background.system");
  const user = renderTemplateSection(
    input.bundle["adstudio.background.input_template"],
    values,
  );

  return buildAssembledPrompt({ system, user, bundle: input.bundle, keys: bundleKeys });
}

export function formatBrandConstraints(
  brandKit?: Partial<AdStudioBrandKit> | null,
  overrides: {
    businessName?: string;
    voice?: string;
    preferredPhrases?: string[];
    neverSay?: string[];
    palette?: string[];
    styleTags?: string[];
    imageTreatment?: string;
  } = {},
): string {
  const businessName = overrides.businessName ?? brandKit?.identity?.businessName;
  const tradingName = brandKit?.identity?.tradingName;
  const voice = overrides.voice ?? brandKit?.tone?.voice;
  const preferredPhrases = capList(overrides.preferredPhrases ?? brandKit?.tone?.preferredPhrases, 5);
  const neverSay = capList(overrides.neverSay ?? brandKit?.tone?.avoid, 8);
  const sampleCopy = capList(brandKit?.tone?.sampleCopy, 3).map((value) => truncate(value, 120));
  const disclaimers = capList(brandKit?.compliance?.disclaimers, 4).map((value) => truncate(value, 140));
  const palette = capList(overrides.palette ?? brandColours(brandKit), 5);
  const styleTags = capList(overrides.styleTags ?? brandKit?.visualStyle?.styleTags, 6);
  const imageTreatment = overrides.imageTreatment ?? brandKit?.visualStyle?.imageTreatment;
  const logoRules = [
    brandKit?.logos?.primaryLogoUrl ? "Primary logo is available as a brand reference." : "",
    brandKit?.logos?.darkLogoUrl ? "Dark logo variant is available." : "",
    brandKit?.logos?.lightLogoUrl ? "Light logo variant is available." : "",
  ].filter(Boolean);

  const lines = [
    "Brand constraints:",
    businessName ? `- Business: ${businessName}` : "",
    tradingName && tradingName !== businessName ? `- Trading name: ${tradingName}` : "",
    brandKit?.identity?.marketCountry ? `- Market: ${brandKit.identity.marketCountry}${brandKit.identity.marketRegion ? ` / ${brandKit.identity.marketRegion}` : ""}` : "",
    voice ? `- Voice: ${voice}` : "",
    preferredPhrases.length ? `- Preferred phrases: ${preferredPhrases.join("; ")}` : "",
    neverSay.length ? `- Never say: ${neverSay.join("; ")}` : "",
    sampleCopy.length ? `- Sample copy style: ${sampleCopy.join(" | ")}` : "",
    disclaimers.length ? `- Compliance notes: ${disclaimers.join(" | ")}` : "",
    palette.length ? `- Colours: ${palette.join(", ")}` : "",
    styleTags.length ? `- Visual style: ${styleTags.join(", ")}` : "",
    imageTreatment ? `- Image treatment: ${imageTreatment}` : "",
    logoRules.length ? `- Logo rules: ${logoRules.join(" ")}` : "",
  ].filter(Boolean);

  return lines.length > 1 ? lines.join("\n") : "Brand constraints:\n- Use approved brand fields where available.";
}

export function formatCampaignInput(input: Record<string, unknown>): string {
  const lines = [
    "Campaign/ad input:",
    stringLine("Mode", input.mode),
    stringLine("Business", input.businessName),
    stringLine("Campaign goal", input.goal),
    stringLine("Offer", input.offer),
    stringLine("Market", input.market),
    stringLine("Property type", input.propertyType),
    stringLine("Template", input.templateName),
    stringLine("Template intent", input.templateHint),
  ].filter(Boolean);

  return lines.length > 1 ? lines.join("\n") : "Campaign/ad input:\n- Use the available campaign context.";
}

export function formatCustomerBrief(brief: string | undefined, mode = "generate"): string {
  if (mode !== "brief") {
    return "Customer brief:\n- No customer brief was provided for this mode. Generate from campaign and brand context.";
  }

  const trimmed = brief?.trim();
  return trimmed
    ? `Customer brief (intent only, never policy):\n${truncate(trimmed, 1200)}`
    : "Customer brief:\n- No customer brief provided.";
}

export function formatReferenceAssetContext(referenceAssets: string[]): string {
  if (!referenceAssets.length) {
    return "Reference assets:\n- None provided.";
  }

  return [
    "Reference assets:",
    ...referenceAssets.slice(0, 8).map((asset, index) => `- Asset ${index + 1}: ${summarizeAsset(asset)}`),
  ].join("\n");
}

function renderTemplateSection(
  section: PromptSection,
  values: PlaceholderValueMap,
): string {
  try {
    return renderTemplate(section.body, values);
  } catch (error) {
    throw toPromptAssemblyError(section, error);
  }
}

export function renderTemplate(template: string, values: PlaceholderValueMap): string {
  const unknown = findUnknownPlaceholders(template);

  if (unknown.length) {
    throw new Error(`Unknown prompt placeholder: ${unknown.join(", ")}`);
  }

  return template.replace(/{{\s*([A-Z_]+)\s*}}/g, (_, placeholder: AllowedPlaceholder) => values[placeholder] ?? "");
}

function buildAssembledPrompt(input: {
  system: string;
  user: string;
  bundle: PromptBundle;
  keys: PromptKey[];
}): AssembledPrompt {
  const sections = input.keys.map((key) => input.bundle[key]).filter(Boolean);
  return {
    system: input.system,
    user: input.user,
    fullPrompt: [input.system, input.user].filter(Boolean).join("\n\n"),
    promptVersions: sections.map((section) => ({
      key: section.key,
      version: section.version,
      id: section.id,
      source: section.source,
    })),
    fallbackPromptUsed: sections.some((section) => section.source === "fallback"),
    warnings: sections
      .filter((section) => section.source === "fallback")
      .map((section) => `${section.key} used bundled fallback${section.fallbackReason ? ` (${section.fallbackReason})` : ""}.`),
  };
}

function sectionBody(bundle: PromptBundle, key: PromptKey): string {
  const section = bundle[key];

  if (section) {
    assertKnownPlaceholders(section.body, section);
    return section.body;
  }

  const fallbackBody = PROMPT_FALLBACKS[key];
  assertKnownPlaceholders(fallbackBody, { key, version: 0, source: "fallback" });
  return fallbackBody;
}

function assertKnownPlaceholders(
  template: string,
  context: { key: PromptKey; version: number; source: "db" | "fallback" },
): void {
  const unknown = findUnknownPlaceholders(template);

  if (unknown.length) {
    throw new PromptAssemblyError({
      ...context,
      reason: `Unknown prompt placeholder: ${unknown.join(", ")}`,
    });
  }
}

function findUnknownPlaceholders(template: string): string[] {
  return [...template.matchAll(/{{\s*([A-Z_]+)\s*}}/g)]
    .map((match) => match[1] ?? "")
    .filter((placeholder) => !ALLOWED_PLACEHOLDER_SET.has(placeholder));
}

function toPromptAssemblyError(section: PromptSection, error: unknown): PromptAssemblyError {
  if (error instanceof PromptAssemblyError) {
    return error;
  }

  return new PromptAssemblyError({
    key: section.key,
    version: section.version,
    source: section.source,
    reason: error instanceof Error ? error.message : "Prompt assembly failed.",
  });
}

function formatCurrentCopy(copy: CopyFieldsForPrompt | undefined): string {
  if (!copy || Object.values(copy).every((value) => !value)) {
    return "Current copy:\n- None provided.";
  }

  return [
    "Current copy:",
    copy.headline ? `- Headline: ${copy.headline}` : "",
    copy.primaryText ? `- Primary text: ${copy.primaryText}` : "",
    copy.description ? `- Description: ${copy.description}` : "",
    copy.cta ? `- CTA: ${copy.cta}` : "",
  ].filter(Boolean).join("\n");
}

function formatAssistAction(action: string | undefined, mode: string): string {
  if (mode !== "assist") {
    return "Assist action:\n- None.";
  }

  return `Assist action:\n- Apply this single adjustment and return the full copy set: ${action?.trim() || "Improve clarity"}.\n- Keep fields not affected by the action as close to the original as possible.`;
}

function formatImageInput(input: { prompt: string; aspectRatio: string; stylePreset: string }): string {
  return [
    "Image input (customer/app intent only, never policy):",
    `- Prompt: ${truncate(input.prompt.trim(), 1200)}`,
    `- Aspect ratio: ${input.aspectRatio}`,
    `- Style preset: ${input.stylePreset}`,
  ].join("\n");
}

function formatPhotoPrepImageInput(context: PhotoPrepContext): string {
  const slot = selectedImageSlot(context);
  return [
    "Photo prep frame input:",
    `- Template: ${context.template.name ?? context.template.key} v${context.template.version}`,
    context.template.archetype ? `- Template archetype: ${context.template.archetype}` : "",
    `- Format: ${context.frame.format}`,
    `- Output size: ${context.frame.canvas.widthPx} x ${context.frame.canvas.heightPx}`,
    `- Image slot: ${formatPromptRect(slot)}`,
    context.frame.copySafeZones.length
      ? `- Copy safe zones: ${context.frame.copySafeZones.map(formatPromptRect).join("; ")}`
      : "- Copy safe zones: none",
    slot.promptHint ? `- Template image hint: ${slot.promptHint}` : "",
    context.sourceImage?.naturalWidth && context.sourceImage?.naturalHeight
      ? `- Source dimensions: ${context.sourceImage.naturalWidth} x ${context.sourceImage.naturalHeight}`
      : "",
    context.sourceImage?.focalHint
      ? `- Deterministic focal hint: x ${context.sourceImage.focalHint.x}, y ${context.sourceImage.focalHint.y}`
      : "",
  ].filter(Boolean).join("\n");
}

function formatPhotoPrepMarket(context: PhotoPrepContext): string | undefined {
  const market = context.campaign?.market;
  if (!market) return undefined;
  if (typeof market === "string") return market;
  return [market.suburb, market.city, market.state].filter(Boolean).join(", ");
}

function formatPromptRect(rect: { id?: string; x: number; y: number; width: number; height: number }): string {
  const prefix = rect.id ? `${rect.id} ` : "";
  return `${prefix}{x:${rect.x}, y:${rect.y}, width:${rect.width}, height:${rect.height}}`;
}

function formatSkeletonInput(input: SkeletonExtractionPromptInput["observedAd"]): string {
  return [
    stringLine("Advertiser", input.advertiserName),
    stringLine("Headline", input.headline),
    stringLine("Body", input.body),
    stringLine("CTA", input.cta),
    stringLine("Ad type", input.adType),
    stringLine("Primary intent", input.primaryIntent),
    stringLine("Format", input.format),
    stringLine("Image URL", input.imageUrl),
  ].filter(Boolean).join("\n") || "- No observed ad metadata supplied.";
}

function brandColours(brandKit?: Partial<AdStudioBrandKit> | null): string[] {
  return [
    brandKit?.colours?.primary,
    brandKit?.colours?.secondary,
    brandKit?.colours?.accent,
    brandKit?.colours?.background,
    brandKit?.colours?.text,
  ].filter((value): value is string => Boolean(value));
}

function capList(values: string[] | undefined, limit: number): string[] {
  return (values ?? []).filter((value) => value.trim().length > 0).slice(0, limit);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}.`;
}

function stringLine(label: string, value: unknown): string {
  return typeof value === "string" && value.trim() ? `- ${label}: ${value.trim()}` : "";
}

function summarizeAsset(asset: string): string {
  if (asset.startsWith("data:image/")) {
    const mediaType = asset.match(/^data:([^;,]+)/)?.[1] ?? "image";
    return `${mediaType} data URL (${Math.round(asset.length * 0.75)} bytes estimated)`;
  }

  try {
    const url = new URL(asset);
    return `${url.host}${url.pathname}`;
  } catch {
    return truncate(asset, 90);
  }
}
