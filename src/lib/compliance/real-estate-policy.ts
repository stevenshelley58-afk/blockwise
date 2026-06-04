export type ComplianceRegion = "AU";
export type ComplianceChannel = "meta" | "google";
export type ComplianceStatus = "approved" | "needs_review" | "blocked";

export type ComplianceFinding = {
  code: string;
  severity: "medium" | "high";
  message: string;
};

export type ComplianceInput = {
  region: ComplianceRegion;
  channel: ComplianceChannel;
  copy: string;
};

export type ComplianceResult = {
  status: ComplianceStatus;
  findings: ComplianceFinding[];
};

const AU_REAL_ESTATE_RULES: Array<{
  code: string;
  severity: "medium" | "high";
  pattern: RegExp;
  message: string;
}> = [
  {
    code: "unsupported_guarantee",
    severity: "high",
    pattern: /\bguarantee(?:d|s)?\b/i,
    message: "Avoid guaranteed price or result claims unless the claim is fully substantiated.",
  },
  {
    code: "unsupported_rank_claim",
    severity: "high",
    pattern: /(?:#1|\bnumber one\b|\bno\.?\s*1\b|\bbest agency\b)/i,
    message: "Rank and superiority claims require current, specific substantiation.",
  },
  {
    code: "misleading_urgency",
    severity: "high",
    pattern: /(?:this weekend|today only|act now|last chance|limited time)/i,
    message: "Urgency claims must not pressure homeowners with unsupported scarcity.",
  },
  {
    code: "housing_targeting_risk",
    severity: "medium",
    pattern: /(?:families only|young professionals only|retirees only|no renters)/i,
    message: "Avoid copy that could imply discriminatory housing targeting.",
  },
];

export function evaluateRealEstateCompliance(input: ComplianceInput): ComplianceResult {
  const findings = AU_REAL_ESTATE_RULES.filter((rule) => rule.pattern.test(input.copy)).map(
    (rule): ComplianceFinding => ({
      code: rule.code,
      severity: rule.severity,
      message: rule.message,
    }),
  );

  if (findings.some((finding) => finding.severity === "high")) {
    return { status: "blocked", findings };
  }

  if (findings.length > 0) {
    return { status: "needs_review", findings };
  }

  return { status: "approved", findings: [] };
}
