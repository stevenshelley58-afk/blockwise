import { evaluatePublishReadiness, type ApprovalStatus, type ProviderConnectionStatus } from "../campaigns/publishing.ts";
import type { ComplianceStatus } from "../compliance/real-estate-policy.ts";

type ProviderKey = "meta" | "google";

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
  googleCustomerId?: string | null;
  metaPayload?: Record<string, unknown> | null;
  googlePayload?: Record<string, unknown> | null;
  validateOnly?: boolean;
}): ProviderPublishRequest[] {
  const requests: ProviderPublishRequest[] = [];

  if (input.metaAccountId && input.metaPayload) {
    requests.push({
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
    });
  }

  if (input.googleCustomerId && input.googlePayload) {
    requests.push({
      provider: "google",
      endpoint: `/${normalizeGoogleCustomerPath(input.googleCustomerId)}/googleAds:mutate`,
      method: "POST",
      body: {
        validateOnly: input.validateOnly ?? false,
        partialFailure: false,
        mutateOperations: [
          {
            campaignOperation: {
              create: {
                name: `Blockwise export ${input.exportPackageId}`,
                status: "PAUSED",
                advertisingChannelType: "SEARCH",
                blockwisePayload: input.googlePayload,
              },
            },
          },
        ],
      },
    });
  }

  return requests;
}

function normalizeGoogleCustomerPath(value: string): string {
  return value.startsWith("customers/") ? value : `customers/${value.replaceAll("-", "")}`;
}
