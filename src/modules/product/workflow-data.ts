import { createAiRunLedgerEntry } from "@/modules/model-control/run-ledger";
import { evaluatePublishReadiness } from "@/modules/campaigns/publishing";
import { evaluateRealEstateCompliance } from "@/modules/compliance/real-estate-policy";
import { buildLeadDedupeKey, findDuplicateLeadIds } from "@/modules/leads/dedupe";
import { campaignDrafts, leads, workspace } from "@/modules/product/demo-data";

export function getCampaignReadinessRows() {
  return campaignDrafts.map((campaign) => {
    const readiness = evaluatePublishReadiness({
      providerConnectionStatus:
        campaign.providerConnectionStatus === "connected" ? "connected" : "needs_attention",
      approvalStatus: campaign.approvalStatus as "requested" | "approved",
      complianceStatus: campaign.complianceStatus as "approved" | "blocked",
      hasDraftPayload: Boolean(campaign.draftPayload),
    });

    return {
      ...campaign,
      readiness,
    };
  });
}

export function getComplianceDemo() {
  return [
    {
      label: "Blocked copy",
      copy: "Guaranteed top price if you sell this weekend. Perth's #1 agency gets instant results.",
      result: evaluateRealEstateCompliance({
        region: "AU",
        channel: "meta",
        copy: "Guaranteed top price if you sell this weekend. Perth's #1 agency gets instant results.",
      }),
    },
    {
      label: "Approved copy",
      copy: "See recent buyer demand and comparable sales activity in your suburb before planning your next move.",
      result: evaluateRealEstateCompliance({
        region: "AU",
        channel: "google",
        copy: "See recent buyer demand and comparable sales activity in your suburb before planning your next move.",
      }),
    },
  ];
}

export function getLeadRowsWithDedupe() {
  const incoming = {
    email: "AMELIA@example.com",
    phone: "0400111222",
  };
  const duplicateIds = findDuplicateLeadIds(leads, incoming);

  return {
    rows: leads.map((lead) => ({
      ...lead,
      dedupeKey: buildLeadDedupeKey(lead),
      duplicateCandidate: duplicateIds.includes(lead.id),
    })),
    incoming: {
      ...incoming,
      dedupeKey: buildLeadDedupeKey(incoming),
      duplicateIds,
    },
  };
}

export function getAiLedgerRows() {
  return [
    createAiRunLedgerEntry({
      workspaceId: workspace.id,
      userId: "user_demo",
      profileKey: "cheap_draft_text",
      task: "campaign_hook_draft",
      outputType: "text",
      usage: { inputTokens: 10_000, outputTokens: 1_000 },
    }),
    createAiRunLedgerEntry({
      workspaceId: workspace.id,
      userId: "user_demo",
      profileKey: "image_final",
      task: "final_image_generation",
      outputType: "image",
      usage: { inputTokens: 0, outputTokens: 0, imageUnits: 30 },
    }),
    createAiRunLedgerEntry({
      workspaceId: workspace.id,
      userId: "user_demo",
      profileKey: "compliance_review",
      task: "real_estate_compliance",
      outputType: "json",
      usage: { inputTokens: 18_000, outputTokens: 2_000 },
    }),
  ];
}
