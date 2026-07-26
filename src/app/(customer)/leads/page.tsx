import { Clock } from "lucide-react";

import { LeadStats } from "@/components/leads/lead-stats";
import { LeadsTable, type LeadListItem } from "@/components/leads/leads-table";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listLeadRowsWithDedupe } from "@/lib/operator/overview";
import { LeadSyncButton } from "./lead-sync-button";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const { rows } = await listLeadRowsWithDedupe(supabase, access.workspaceId);
  const highIntentCount = rows.filter((lead) => lead.quality === "high_intent").length;
  const duplicateCount = rows.filter((lead) => lead.duplicateCandidate).length;
  const canEditLeadQuality = access.role === "owner" || access.role === "admin" || access.role === "operator";

  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select("last_meta_lead_sync_at")
    .eq("id", access.workspaceId)
    .maybeSingle();
  const lastSyncedAt =
    (workspaceRow as { last_meta_lead_sync_at?: string | null } | null)?.last_meta_lead_sync_at ?? null;
  const syncLabel = lastSyncedAt
    ? niche.copy.leads.syncedAt(
        new Intl.DateTimeFormat("en-AU", { timeStyle: "short", timeZone: "Australia/Perth" }).format(
          new Date(lastSyncedAt),
        ),
      )
    : niche.copy.leads.neverSynced;

  const copy = niche.copy.leads;

  const items: LeadListItem[] = rows.map((lead) => ({
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    suburb: lead.suburb,
    source: lead.source,
    attribution: lead.attribution,
    quality: leadQualityValue(lead.quality),
    createdAt: lead.createdAt,
    duplicateCandidate: Boolean(lead.duplicateCandidate),
    delivery: lead.delivery,
  }));

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16" aria-label={copy.title}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] md:text-[28px]">{copy.title}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.captured(rows.length)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Clock size={13} aria-hidden />
            {syncLabel}
          </span>
          <LeadSyncButton workspaceId={access.workspaceId} />
        </div>
      </header>

      <div className="mt-6">
        <LeadStats total={rows.length} highIntent={highIntentCount} duplicates={duplicateCount} />
      </div>

      <div className="mt-3.5">
        <LeadsTable rows={items} workspaceId={access.workspaceId} canEditQuality={canEditLeadQuality} />
      </div>
    </main>
  );
}

function leadQualityValue(value: string | null | undefined): LeadListItem["quality"] {
  return value === "valid" || value === "invalid" || value === "high_intent" ? value : "unlabelled";
}
