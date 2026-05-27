import { evaluateRealEstateCompliance } from "../compliance/real-estate-policy.ts";

import { deterministicUuid } from "./id.ts";
import {
  validateGoogleAssetPack,
  validateGoogleSearchPack,
  validateMetaLeadAdPack,
} from "./platform-rules.ts";
import type {
  AdStudioCampaign,
  AdStudioComplianceReport,
  AdStudioPlatformCopyPack,
  ComplianceIssue,
} from "./types.ts";

const BLOCKED_COPY_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  {
    code: "discriminatory_audience_wording",
    pattern: /\b(?:young families|single professionals|safe suburb for retirees|families only|retirees only)\b/i,
    message: "Avoid housing copy that implies protected-class or life-stage targeting.",
  },
  {
    code: "fake_listing_claim",
    pattern: /\b(?:only 3 homes left|exclusive off-market stock|buyers ready to pay top dollar)\b/i,
    message: "Avoid fake scarcity, fake listing inventory, or unsupported buyer-demand claims.",
  },
  {
    code: "financial_advice_language",
    pattern: /\b(?:guaranteed investment return|risk-free property|financial advice)\b/i,
    message: "Avoid financial advice or guaranteed investment language.",
  },
];

export function runAdStudioComplianceReview(input: {
  campaign: AdStudioCampaign;
  copyPacks: AdStudioPlatformCopyPack[];
}): AdStudioComplianceReport {
  const issues: ComplianceIssue[] = [];

  for (const copyPack of input.copyPacks) {
    issues.push(...validateMetaLeadAdPack(copyPack.meta).issues);
    issues.push(...validateGoogleSearchPack(copyPack.googleSearch).issues);
    issues.push(...validateGoogleAssetPack(copyPack.googlePmax).issues);
    issues.push(...validateGoogleAssetPack(copyPack.googleDemandGen).issues);
    issues.push(...reviewCopyText(copyPack));
  }

  if (input.campaign.platforms.includes("meta")) {
    for (const copyPack of input.copyPacks) {
      if (copyPack.meta.specialAdCategory !== "housing") {
        issues.push({
          code: "housing_special_category_required",
          severity: "blocking",
          message: "Housing-related Meta campaigns must be marked as Special Ad Category: Housing.",
        });
      }
    }
  }

  const blocking = issues.some((issue) => issue.severity === "blocking");
  const warnings = issues.some((issue) => issue.severity === "warning");

  return {
    reportId: deterministicUuid(`compliance:${input.campaign.campaignId}`),
    campaignId: input.campaign.campaignId,
    status: blocking ? "blocked" : warnings ? "needs_review" : "approved",
    issues: dedupeIssues(issues),
    checkedAt: new Date("2026-05-27T00:00:00.000Z").toISOString(),
  };
}

function reviewCopyText(copyPack: AdStudioPlatformCopyPack): ComplianceIssue[] {
  const text = [
    ...copyPack.meta.primaryText,
    ...copyPack.meta.headlines,
    ...copyPack.meta.descriptions,
    ...copyPack.googleSearch.headlines,
    ...copyPack.googleSearch.descriptions,
    copyPack.landingPage.headline,
    copyPack.landingPage.subheadline,
    ...copyPack.followUp.sms,
    ...copyPack.followUp.email.flatMap((email) => [email.subject, email.body]),
  ].join("\n");
  const baseResult = evaluateRealEstateCompliance({
    region: "AU",
    channel: "meta",
    copy: text,
  });
  const issues: ComplianceIssue[] = baseResult.findings.map((finding) => ({
    code: finding.code,
    severity: finding.severity === "high" ? "blocking" : "warning",
    message: finding.message,
  }));

  for (const rule of BLOCKED_COPY_PATTERNS) {
    if (rule.pattern.test(text)) {
      issues.push({
        code: rule.code,
        severity: "blocking",
        message: rule.message,
      });
    }
  }

  return issues;
}

function dedupeIssues(issues: ComplianceIssue[]): ComplianceIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
