import {
  googleAssetPackSchema,
  googleSearchPackSchema,
  metaLeadAdPackSchema,
  type ComplianceIssue,
  type GoogleAssetPack,
  type GoogleSearchPack,
  type MetaLeadAdPack,
} from "./types.ts";

export type PlatformValidationResult = {
  valid: boolean;
  issues: ComplianceIssue[];
};

export const GOOGLE_SEARCH_LIMITS = {
  minHeadlines: 3,
  minDescriptions: 2,
  headlineChars: 30,
  descriptionChars: 90,
  pathChars: 15,
};

export const GOOGLE_PMAX_REQUIRED_IMAGE_FORMATS = ["landscape_1_91", "square_1_1", "portrait_4_5"] as const;

export function validateMetaLeadAdPack(pack: MetaLeadAdPack): PlatformValidationResult {
  const parsed = metaLeadAdPackSchema.safeParse(pack);
  const issues: ComplianceIssue[] = [];

  if (!parsed.success) {
    issues.push({
      code: "meta_schema_invalid",
      severity: "blocking",
      message: "Meta lead ad pack does not match the required schema.",
    });
  }

  if (pack.specialAdCategory !== "housing") {
    issues.push({
      code: "meta_housing_special_category_required",
      severity: "blocking",
      message: "Housing-related Meta campaigns must be marked as Special Ad Category: Housing.",
    });
  }

  if (!pack.leadForm.privacyPolicyUrl) {
    issues.push({
      code: "meta_lead_form_privacy_policy_required",
      severity: "blocking",
      message: "Meta lead forms need a privacy policy URL before export or publish.",
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "blocking"),
    issues,
  };
}

export function validateGoogleSearchPack(pack: GoogleSearchPack): PlatformValidationResult {
  const parsed = googleSearchPackSchema.safeParse(pack);
  const issues: ComplianceIssue[] = [];

  if (!parsed.success) {
    issues.push({
      code: "google_search_schema_invalid",
      severity: "blocking",
      message: "Google Search pack does not match the required schema.",
    });
  }

  if (!pack.finalUrl) {
    issues.push({
      code: "google_search_final_url_required",
      severity: "blocking",
      message: "Google Search ads require a final URL.",
    });
  }

  if (pack.headlines.length < GOOGLE_SEARCH_LIMITS.minHeadlines) {
    issues.push({
      code: "google_search_min_headlines",
      severity: "blocking",
      message: "Google Search responsive ads need at least 3 headlines.",
    });
  }

  if (pack.descriptions.length < GOOGLE_SEARCH_LIMITS.minDescriptions) {
    issues.push({
      code: "google_search_min_descriptions",
      severity: "blocking",
      message: "Google Search responsive ads need at least 2 descriptions.",
    });
  }

  if (pack.headlines.some((headline) => charCount(headline) > GOOGLE_SEARCH_LIMITS.headlineChars)) {
    issues.push({
      code: "google_search_headline_too_long",
      severity: "blocking",
      message: "Google Search headlines must be 30 characters or fewer.",
    });
  }

  if (pack.descriptions.some((description) => charCount(description) > GOOGLE_SEARCH_LIMITS.descriptionChars)) {
    issues.push({
      code: "google_search_description_too_long",
      severity: "blocking",
      message: "Google Search descriptions must be 90 characters or fewer.",
    });
  }

  if (pack.paths.some((path) => charCount(path) > GOOGLE_SEARCH_LIMITS.pathChars)) {
    issues.push({
      code: "google_search_path_too_long",
      severity: "blocking",
      message: "Google Search display paths must be 15 characters or fewer.",
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "blocking"),
    issues,
  };
}

export function validateGoogleAssetPack(pack: GoogleAssetPack): PlatformValidationResult {
  const parsed = googleAssetPackSchema.safeParse(pack);
  const issues: ComplianceIssue[] = [];

  if (!parsed.success) {
    issues.push({
      code: "google_asset_schema_invalid",
      severity: "blocking",
      message: "Google asset pack does not match the required schema.",
    });
  }

  for (const format of GOOGLE_PMAX_REQUIRED_IMAGE_FORMATS) {
    if (pack.images[format].length === 0) {
      issues.push({
        code: `google_asset_${format}_required`,
        severity: "blocking",
        message: `Google asset groups require ${format.replaceAll("_", " ")} images.`,
      });
    }
  }

  if (pack.logos.square.length === 0) {
    issues.push({
      code: "google_square_logo_required",
      severity: "warning",
      message: "A square logo should be included before publishing Google asset groups.",
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "blocking"),
    issues,
  };
}

function charCount(value: string): number {
  return [...value].length;
}
