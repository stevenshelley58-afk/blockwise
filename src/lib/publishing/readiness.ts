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

  // "needs_review" no longer blocks: the human compliance review step was
  // removed from the product (Meta runs its own ad review), and every pack
  // defaults to "needs_review", so blocking on it froze all publishes.
  // Hard "blocked" findings still stop the publish.
  if (input.complianceStatus === "blocked") {
    blockers.push("Compliance review has unresolved high-risk findings.");
  }

  if (!input.hasDraftPayload) {
    blockers.push("Provider draft payload is missing.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}
