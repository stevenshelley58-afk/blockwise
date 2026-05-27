import type { ComplianceStatus } from "@/lib/compliance/real-estate-policy";

export type ApprovalStatus = "draft" | "requested" | "approved" | "rejected" | "cancelled";
export type ProviderConnectionStatus = "connected" | "needs_attention" | "not_connected";

export type PublishReadinessInput = {
  providerConnectionStatus: ProviderConnectionStatus;
  approvalStatus: ApprovalStatus;
  complianceStatus: ComplianceStatus;
  hasDraftPayload: boolean;
};

export type PublishReadiness = {
  ready: boolean;
  blockers: string[];
};

export function evaluatePublishReadiness(input: PublishReadinessInput): PublishReadiness {
  const blockers: string[] = [];

  if (input.providerConnectionStatus !== "connected") {
    blockers.push("Provider connection is not healthy.");
  }

  if (input.approvalStatus !== "approved") {
    blockers.push("Human approval is required before publishing.");
  }

  if (input.complianceStatus === "blocked") {
    blockers.push("Compliance review has unresolved high-risk findings.");
  }

  if (input.complianceStatus === "needs_review") {
    blockers.push("Compliance review still needs human review.");
  }

  if (!input.hasDraftPayload) {
    blockers.push("Provider draft payload is missing.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}
