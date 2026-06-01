import { BadgeCheck, Megaphone, ShieldCheck, TriangleAlert } from "lucide-react";

import { MetricCard } from "@/ui/metric-card";
import { PageHeading } from "@/ui/page-heading";
import { StatusPill } from "@/ui/status-pill";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";
import { listCampaignReadinessRows } from "@/modules/product/live-data";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");
  const campaigns = await listCampaignReadinessRows(supabase, access.workspaceId);
  const readyCount = campaigns.filter((campaign) => campaign.readiness.ready).length;
  const blockedCount = campaigns.length - readyCount;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Campaign operations"
        title="Campaigns"
        description="Draft Meta and Google campaigns, validate compliance, map provider payloads, and block publishing until provider health and human approval are clear."
      />

      <section className="grid cols-4">
        <MetricCard icon={Megaphone} label="Drafts" value={String(campaigns.length)} note="Meta and Google provider payloads" />
        <MetricCard icon={BadgeCheck} label="Ready" value={String(readyCount)} note="Approved, compliant, connected" />
        <MetricCard icon={TriangleAlert} label="Blocked" value={String(blockedCount)} note="Approval, compliance, or provider health" />
        <MetricCard icon={ShieldCheck} label="Publishing Gate" value="On" note="No live publish without approval" />
      </section>

      <section className="panel">
        <h2>Publish Readiness</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Provider</th>
              <th>Approval</th>
              <th>Compliance</th>
              <th>Readiness</th>
              <th>Blockers</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>{campaign.name}</td>
                <td>{campaign.provider}</td>
                <td>{campaign.approvalStatus}</td>
                <td>{campaign.complianceStatus}</td>
                <td>
                  <StatusPill tone={campaign.readiness.ready ? "green" : "amber"}>
                    {campaign.readiness.ready ? "ready" : "blocked"}
                  </StatusPill>
                </td>
                <td>{campaign.readiness.blockers.join(" ") || "Ready for provider publish call."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
