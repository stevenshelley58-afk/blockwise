import { Download, Fingerprint, Tags, UsersRound } from "lucide-react";

import { MetricCard } from "@/ui/metric-card";
import { PageHeading } from "@/ui/page-heading";
import { StatusPill } from "@/ui/status-pill";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";
import { listLeadRowsWithDedupe } from "@/modules/product/live-data";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const { rows, incoming } = await listLeadRowsWithDedupe(supabase, access.workspaceId);
  const highIntentCount = rows.filter((lead) => lead.quality === "High intent").length;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Lead operations"
        title="Leads"
        description="Ingest Meta leads, Google lead forms, CSV and manual imports, dedupe identities, label quality, attribute sources, and audit exports."
      />

      <section className="grid cols-4">
        <MetricCard icon={UsersRound} label="Leads" value={String(rows.length)} note="Provider and import sources" />
        <MetricCard icon={Tags} label="High intent" value={String(highIntentCount)} note="Quality labels feed reporting" />
        <MetricCard icon={Fingerprint} label="Duplicates" value={String(incoming.duplicateIds.length)} note="Normalized email and phone dedupe" />
        <MetricCard icon={Download} label="Exports" value="0" note="PII exports require approval" />
      </section>

      <section className="panel">
        <h2>Lead Inbox</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Suburb</th>
              <th>Source</th>
              <th>Quality</th>
              <th>Dedupe</th>
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
                    {lead.duplicateCandidate ? "duplicate candidate" : "unique"}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Dedupe Record</h2>
        <p className="item-meta">Incoming key: {incoming.dedupeKey}</p>
        <p className="item-meta">Matched lead IDs: {incoming.duplicateIds.join(", ") || "none"}</p>
      </section>
    </main>
  );
}
