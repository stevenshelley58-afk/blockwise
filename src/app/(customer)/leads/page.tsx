import { Download, Fingerprint, Tags, UsersRound } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listLeadRowsWithDedupe } from "@/lib/product/live-data";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const { rows, incoming } = await listLeadRowsWithDedupe(supabase, access.workspaceId);
  const highIntentCount = rows.filter((lead) => lead.quality === "High intent").length;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Your leads"
        title="Leads"
        description="Every lead from Meta, Google, and imports in one place. We merge duplicates, flag the hot ones, and keep exports secure."
      />

      <section className="grid cols-4">
        <MetricCard icon={UsersRound} label="Leads" value={String(rows.length)} note="From ads and imports" />
        <MetricCard icon={Tags} label="High intent" value={String(highIntentCount)} note="Most likely to convert" />
        <MetricCard icon={Fingerprint} label="Duplicates merged" value={String(incoming.duplicateIds.length)} note="Same person, matched by email or phone" />
        <MetricCard icon={Download} label="Exports" value="0" note="Exports need approval" />
      </section>

      <section className="panel">
        <h2>Your leads</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Suburb</th>
              <th>Source</th>
              <th>Quality</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.name}</td>
                <td>{lead.suburb}</td>
                <td>{lead.source}</td>
                <td>{lead.quality}</td>
                <td>
                  <StatusPill tone={lead.duplicateCandidate ? "amber" : "green"}>
                    {lead.duplicateCandidate ? "possible duplicate" : "new"}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Duplicate matches</h2>
        <p className="item-meta">Matched on: {incoming.dedupeKey}</p>
        <p className="item-meta">Matched leads: {incoming.duplicateIds.join(", ") || "none"}</p>
      </section>
    </main>
  );
}
