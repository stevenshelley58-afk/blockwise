import { Clock, Fingerprint, Tags, UsersRound } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listLeadRowsWithDedupe, type LeadQualityLabel } from "@/lib/operator/overview";
import { LeadQualitySelect } from "./lead-quality-select";
import { LeadSyncButton } from "./lead-sync-button";

type LeadQualityValue = LeadQualityLabel | "unlabelled";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const { rows } = await listLeadRowsWithDedupe(supabase, access.workspaceId);
  const highIntentCount = rows.filter((lead) => leadQualityValue(lead.quality) === "high_intent").length;
  const duplicateCount = rows.filter((lead) => lead.duplicateCandidate).length;
  const canEditLeadQuality = access.role === "owner" || access.role === "admin" || access.role === "operator";

  return (
    <main className="content">
      <PageHeading
        eyebrow="Your leads"
        title="Leads"
        description="Every Meta lead in one place. We flag duplicates, highlight high-intent leads, and keep your data secure."
      />

      <section className="grid cols-3">
        <MetricCard icon={UsersRound} label="Leads" value={String(rows.length)} note="From Meta ads" />
        <MetricCard icon={Tags} label="High intent" value={String(highIntentCount)} note="Most likely to convert" />
        <MetricCard icon={Fingerprint} label="Duplicates flagged" value={String(duplicateCount)} note="Same person, matched by email or phone" />
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
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Suburb</th>
                    <th>Source</th>
                    <th>Quality</th>
                    <th>Delivery</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.name}</td>
                      <td>{lead.email || "-"}</td>
                      <td>{lead.phone || "-"}</td>
                      <td>{lead.suburb}</td>
                      <td>{lead.source}</td>
                      <td>
                        <LeadQualitySelect
                          leadId={lead.id}
                          workspaceId={access.workspaceId}
                          value={leadQualityValue(lead.quality)}
                          disabled={!canEditLeadQuality}
                        />
                      </td>
                      <td>{lead.delivery}</td>
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
                      <dt>Email</dt>
                      <dd>{lead.email || "-"}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{lead.phone || "-"}</dd>
                    </div>
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
                      <dd>
                        <LeadQualitySelect
                          leadId={lead.id}
                          workspaceId={access.workspaceId}
                          value={leadQualityValue(lead.quality)}
                          disabled={!canEditLeadQuality}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Delivery</dt>
                      <dd>{lead.delivery}</dd>
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
    </main>
  );
}

function leadQualityValue(value: string | null | undefined): LeadQualityValue {
  return value === "valid" || value === "invalid" || value === "high_intent" ? value : "unlabelled";
}
