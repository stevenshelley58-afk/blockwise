import Link from "next/link";
import { Clock } from "lucide-react";

import { LeadStats } from "@/components/leads/lead-stats";
import { LeadsTable, type LeadListItem } from "@/components/leads/leads-table";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listLeadRowsWithDedupe } from "@/lib/operator/overview";
import { LeadSyncButton } from "./lead-sync-button";

export const dynamic = "force-dynamic";

/** The window the page headline claims ("captured in the last 30 days"). */
const CAPTURED_WINDOW_DAYS = 30;

export default async function LeadsPage() {
  const { supabase, access, auth } = await requirePageSurfaceAccess("monitor");
  const { rows } = await listLeadRowsWithDedupe(supabase, access.workspaceId);
  // `listLeadRowsWithDedupe` returns every lead in the workspace, so the
  // headline count has to be derived here or the "last 30 days" claim lies.
  const capturedSince = Date.now() - CAPTURED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const capturedRecently = rows.filter((lead) => {
    const capturedAt = Date.parse(lead.createdAt);
    return Number.isFinite(capturedAt) && capturedAt >= capturedSince;
  }).length;
  const highIntentCount = rows.filter((lead) => lead.quality === "high_intent").length;
  const duplicateCount = rows.filter((lead) => lead.duplicateCandidate).length;
  const canEditLeadQuality = access.role === "owner" || access.role === "admin" || access.role === "operator";

  const { data: metaConnection } = await supabase
    .from("provider_connections")
    .select("status")
    .eq("workspace_id", access.workspaceId)
    .eq("provider", "meta")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const metaConnected = metaConnection?.status === "connected";

  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select("last_meta_lead_sync_at")
    .eq("id", access.workspaceId)
    .maybeSingle();
  const lastSyncedAt =
    (workspaceRow as { last_meta_lead_sync_at?: string | null } | null)?.last_meta_lead_sync_at ?? null;
  const syncLabel = lastSyncedAt
    ? niche.copy.leads.syncedAt(
        new Intl.DateTimeFormat("en-AU", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: resolveTimeZone(auth.claims?.user_metadata?.timezone, access.region),
        }).format(new Date(lastSyncedAt)),
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
    <section className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16" aria-label={copy.title}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">{copy.title}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.captured(capturedRecently)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Clock size={13} aria-hidden />
            {syncLabel}
          </span>
          {metaConnected || rows.length > 0 ? <LeadSyncButton workspaceId={access.workspaceId} /> : null}
        </div>
      </header>

      {!metaConnected && rows.length === 0 ? (
        <section className="mt-8 grid place-items-center rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface) px-6 py-14 text-center shadow-card">
          <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">{copy.disconnected.title}</h2>
          <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-muted-foreground">{copy.disconnected.body}</p>
          <Link href="/connect-meta" className="mt-5 inline-flex h-10 items-center rounded-full bg-(--ink) px-5 text-[13px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.97]">
            {copy.disconnected.connectCta}
          </Link>
        </section>
      ) : (
        <>
          <div className="mt-6">
            <LeadStats total={rows.length} highIntent={highIntentCount} duplicates={duplicateCount} />
          </div>
          <div className="mt-3.5">
            <LeadsTable rows={items} workspaceId={access.workspaceId} canEditQuality={canEditLeadQuality} />
          </div>
        </>
      )}
    </section>
  );
}

function resolveTimeZone(value: unknown, region: string | undefined) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Fall through to the workspace-region default.
    }
  }
  return region === "US" ? "America/New_York" : "Australia/Sydney";
}

function leadQualityValue(value: string | null | undefined): LeadListItem["quality"] {
  return value === "valid" || value === "invalid" || value === "high_intent" ? value : "unlabelled";
}
