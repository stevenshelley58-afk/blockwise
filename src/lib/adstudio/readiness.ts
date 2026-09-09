import type { AdStudioCampaignPack } from "./types.ts";

export type AdStudioCopyState = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export type ReadinessItem = {
  label: string;
  detail: string;
  state: "done" | "warn" | "todo";
};

export const COPY_LIMITS: Record<keyof AdStudioCopyState, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

// Single source of truth for CTA mapping lives in meta-cta.ts.
import { toMetaCta } from "./meta-cta.ts";
export { toMetaCta };

/**
 * Meta rejects (or truncates) over-limit copy — publishing it is a foot-gun,
 * so export/publish BLOCK on violations instead of warning.
 */
export function findCopyLimitViolations(copy: AdStudioCopyState): string[] {
  const violations: string[] = [];
  for (const [key, limit] of Object.entries(COPY_LIMITS) as Array<[keyof AdStudioCopyState, number]>) {
    const value = copy[key] ?? "";
    if (value.length > limit) {
      violations.push(`${key} is ${value.length} characters (Meta limit ${limit}).`);
    }
  }
  return violations;
}

/** Violations across every variant's primary Meta copy in a pack. */
export function findPackCopyLimitViolations(pack: {
  copyPacks: Array<{ meta: { primaryText: string[]; headlines: string[]; descriptions: string[] } }>;
}): string[] {
  const seen = new Set<string>();
  for (const copyPack of pack.copyPacks) {
    for (const violation of findCopyLimitViolations({
      primaryText: copyPack.meta.primaryText[0] ?? "",
      headline: copyPack.meta.headlines[0] ?? "",
      description: copyPack.meta.descriptions[0] ?? "",
      cta: "",
    })) {
      seen.add(violation);
    }
  }
  return [...seen];
}

export function findLeadFormViolations(pack: {
  copyPacks: Array<{ meta?: { leadForm?: { questions?: unknown } } } | null | undefined>;
}): string[] {
  const seen = new Set<string>();
  for (const copyPack of pack.copyPacks ?? []) {
    const questions = copyPack?.meta?.leadForm?.questions;
    if (!Array.isArray(questions)) {
      seen.add("A lead form question list is missing.");
      continue;
    }
    if (questions.some((question) => typeof question !== "string" || !question.trim())) {
      seen.add("A lead form question label is empty.");
    }
    if (questions.length > 5) seen.add(`A lead form has ${questions.length} questions (Meta limit 5).`);
    const labels = questions
      .filter((question): question is string => typeof question === "string")
      .map((question) => question.trim().toLowerCase())
      .filter(Boolean);
    if (new Set(labels).size !== labels.length) seen.add("A lead form has duplicate questions.");
  }
  return [...seen];
}

export function buildReadinessItems(input: {
  campaignGoal: string;
  offerLabel: string;
  market: string;
  propertyType: string;
  destinationUrl: string;
  primaryImage: string;
  copy: AdStudioCopyState;
  pack: AdStudioCampaignPack;
}): ReadinessItem[] {
  return [
    { label: "Goal & offer", detail: `${input.campaignGoal} / ${input.offerLabel}`, state: input.campaignGoal && input.offerLabel ? "done" : "todo" },
    { label: "Location", detail: input.market, state: input.market ? "done" : "todo" },
    { label: "Property type", detail: input.propertyType, state: input.propertyType ? "done" : "todo" },
    { label: "Landing page", detail: input.destinationUrl || "Add destination URL", state: input.destinationUrl ? "done" : "todo" },
    { label: "Primary media", detail: input.primaryImage ? "Image uploaded" : "Upload image", state: input.primaryImage ? "done" : "todo" },
    {
      label: "Ad copy",
      detail: input.copy.headline
        ? input.copy.headline.length > COPY_LIMITS.headline
          ? "Headline is over the character limit"
          : "Headline looks good"
        : "Add primary headline",
      state: input.copy.headline
        ? input.copy.headline.length <= COPY_LIMITS.headline
          ? "done"
          : "warn"
        : "todo",
    },
    {
      label: "Call to action",
      detail: input.copy.cta ? input.copy.cta : "Add CTA",
      state: input.copy.cta ? ctaState(input.copy.cta) : "todo",
    },
    {
      label: "Compliance",
      detail: complianceDetail(input.pack.compliance.status),
      state: complianceState(input.pack.compliance.status),
    },
  ];
}

function ctaState(label: string): ReadinessItem["state"] {
  return ["SIGN_UP", "DOWNLOAD", "CONTACT_US", "LEARN_MORE"].includes(toMetaCta(label)) ? "done" : "warn";
}

function complianceDetail(status: AdStudioCampaignPack["compliance"]["status"]): string {
  if (status === "approved") return "Checked";
  if (status === "blocked") return "Blocked";
  return "Needs review";
}

function complianceState(status: AdStudioCampaignPack["compliance"]["status"]): ReadinessItem["state"] {
  if (status === "approved") return "done";
  if (status === "needs_review") return "warn";
  return "todo";
}
