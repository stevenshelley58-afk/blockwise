import { evaluatePublishReadiness, type ApprovalStatus, type ProviderConnectionStatus } from "../publishing/readiness.ts";
import type { ComplianceStatus } from "../compliance/real-estate-policy.ts";

type ProviderKey = "meta";

export type ProviderPublishRequest = {
  provider: ProviderKey;
  endpoint: string;
  method: "POST";
  body: Record<string, unknown>;
};

export function resolveAdStudioPublishReadiness(input: {
  approvalStatus: ApprovalStatus;
  complianceStatus: ComplianceStatus;
  providerStatuses: Partial<Record<ProviderKey, ProviderConnectionStatus>>;
  hasDraftPayload: boolean;
}) {
  const providerStatus = Object.values(input.providerStatuses).every((status) => status === "connected")
    ? "connected"
    : "needs_attention";

  return evaluatePublishReadiness({
    providerConnectionStatus: providerStatus,
    approvalStatus: input.approvalStatus,
    complianceStatus: input.complianceStatus,
    hasDraftPayload: input.hasDraftPayload,
  });
}

export function buildAdStudioPublishRequests(input: {
  exportPackageId: string;
  workspaceId: string;
  metaAccountId?: string | null;
  metaPayload?: Record<string, unknown> | null;
}): ProviderPublishRequest[] {
  if (!input.metaAccountId || !input.metaPayload) {
    return [];
  }

  return [{
    provider: "meta",
    endpoint: `/${input.metaAccountId}/campaigns`,
    method: "POST",
    body: {
      name: `Blockwise export ${input.exportPackageId}`,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: ["HOUSING"],
      blockwise_workspace_id: input.workspaceId,
      blockwise_payload: input.metaPayload,
    },
  }];
}
