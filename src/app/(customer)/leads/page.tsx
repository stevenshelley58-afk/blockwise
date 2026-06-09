import { Fingerprint, Tags, UsersRound } from "lucide-react";
import Link from "next/link";

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
  const duplicateCount = incoming.duplicateIds.length;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Your leads"
        title="Leads"
        description="Every Meta lead in one place. We merge duplicates, flag the hot ones, and keep your data secure."
      />

      <section className="grid cols-4">
        <MetricCard icon={UsersRound} label="Leads" value={String(rows.length)} note="From Meta ads" />
        <MetricCard icon={Tags} label="High intent" value={String(highIntentCount)} note="Most likely to convert" />
        <MetricCard icon={Fingerprint} label="Duplicates merged" value={String(incoming.duplicateIds.length)} note="Same person, matched by email or phone" />
      </section>

      <section className="panel leads-panel">
        <h2>Your leads</h2>
        {rows.length === 0 ? (
          <div className="leads-empty-state">
            <p>No leads yet. Leads appear here when your Meta ad campaigns are live through Blockwise.</p>
            <Link href="/ad-studio" className="btn btn-primary">Go to Ad Studio</Link>
          </div>
        ) : (
          <>
            <div className="leads-table-wrap">
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
                          {lead.duplicateCandidate ? "Possible duplicate" : "New"}
                        </StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="leads-mobile-list" aria-label="Leads">
              {rows.map((lead) => (
                <article className="lead-mobile-card" key={lead.id}>
                  <div className="lead-card-title">
                    <div>
                      <span className="lead-card-label">Name</span>
                      <strong>{lead.name}</strong>
                    </div>
                    <StatusPill tone={lead.duplicateCandidate ? "amber" : "green"}>
                      {lead.duplicateCandidate ? "Possible duplicate" : "New"}
                    </StatusPill>
                  </div>
                  <dl className="lead-card-fields">
                    <div>
                      <dt>Suburb</dt>
                      <dd>{lead.suburb}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{lead.source}</dd>
                    </div>
                    <div>
                      <dt>Quality</dt>
                      <dd>{lead.quality}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{lead.duplicateCandidate ? "Possible duplicate" : "New"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {(duplicateCount > 0 || rows.length > 0) && <section className="panel leads-duplicate-panel">
        <div className="leads-duplicate-summary">
          <span className="leads-duplicate-count">{duplicateCount}</span>
          <div>
            <h2>Duplicate matches</h2>
            <p className="item-meta">
              {duplicateCount === 1 ? "1 lead matched the incoming identity." : `${duplicateCount} leads matched the incoming identity.`}
            </p>
          </div>
        </div>
        <dl className="leads-duplicate-details">
          <div>
            <dt>Matched on</dt>
            <dd>{incoming.dedupeKey || "none"}</dd>
          </div>
          <div>
            <dt>Matched leads</dt>
            <dd>{incoming.duplicateIds.join(", ") || "none"}</dd>
          </div>
        </dl>
      </section>}
    </main>
  );
}
