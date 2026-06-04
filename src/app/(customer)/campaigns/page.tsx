import { BadgeCheck, Megaphone, ShieldCheck, TriangleAlert } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listCampaignReadinessRows } from "@/lib/product/live-data";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("campaigns");
  const campaigns = await listCampaignReadinessRows(supabase, access.workspaceId);
  const readyCount = campaigns.filter((campaign) => campaign.readiness.ready).length;
  const blockedCount = campaigns.length - readyCount;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Your campaigns"
        title="Campaigns"
        description="Build your Meta and Google ads, run the brand check, and we hold anything that isn't ready until it's approved and connected."
      />

      <section className="grid cols-4">
        <MetricCard icon={Megaphone} label="Drafts" value={String(campaigns.length)} note="Across Meta and Google" />
        <MetricCard icon={BadgeCheck} label="Ready" value={String(readyCount)} note="Approved, brand-checked, connected" />
        <MetricCard icon={TriangleAlert} label="Needs attention" value={String(blockedCount)} note="Waiting on approval, brand check, or connection" />
        <MetricCard icon={ShieldCheck} label="Safe publishing" value="On" note="Nothing goes live without approval" />
      </section>

      <section className="panel">
        <h2>Ready to publish?</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Where</th>
              <th>Approval</th>
              <th>Brand check</th>
              <th>Status</th>
              <th>What's needed</th>
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
                <td>{campaign.readiness.blockers.join(" ") || "Ready to publish."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
