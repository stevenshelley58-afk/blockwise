import { Clock, Fingerprint, Tags, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select("last_meta_lead_sync_at")
    .eq("id", access.workspaceId)
    .maybeSingle();
  const lastSyncedAt = (workspaceRow as { last_meta_lead_sync_at?: string | null } | null)?.last_meta_lead_sync_at ?? null;
  const lastSyncedLabel = lastSyncedAt
    ? `Last synced ${new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Perth" }).format(new Date(lastSyncedAt))}`
    : "Never synced";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6" aria-label="Leads">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <div className="flex items-center gap-3">
          <LeadSyncButton workspaceId={access.workspaceId} />
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock size={14} aria-hidden="true" />
            {lastSyncedLabel}
          </span>
        </div>
      </header>

      <section className="mb-6 grid gap-4 sm:grid-cols-3" aria-label="Lead metrics">
        <MetricStat icon={UsersRound} label="Leads" value={String(rows.length)} />
        <MetricStat icon={Tags} label="High intent" value={String(highIntentCount)} />
        <MetricStat icon={Fingerprint} label="Duplicates flagged" value={String(duplicateCount)} note="Matched by email or phone" />
      </section>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-(--r-card) border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">No leads yet.</p>
          <Button asChild>
            <Link href="/ad-studio">Create an ad</Link>
          </Button>
        </div>
      ) : (
        <>
          <Card className="hidden gap-0 py-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Suburb</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell>{lead.email || "-"}</TableCell>
                    <TableCell>{lead.phone || "-"}</TableCell>
                    <TableCell>{lead.suburb}</TableCell>
                    <TableCell>{lead.source}</TableCell>
                    <TableCell>
                      <LeadQualitySelect
                        leadId={lead.id}
                        workspaceId={access.workspaceId}
                        value={leadQualityValue(lead.quality)}
                        disabled={!canEditLeadQuality}
                      />
                    </TableCell>
                    <TableCell>{lead.delivery}</TableCell>
                    <TableCell>
                      <LeadStatusBadge duplicate={Boolean(lead.duplicateCandidate)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-col gap-3 md:hidden" aria-label="Leads">
            {rows.map((lead) => (
              <Card key={lead.id} className="gap-0 py-4">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{lead.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.suburb}</p>
                    </div>
                    <LeadStatusBadge duplicate={Boolean(lead.duplicateCandidate)} />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd className="truncate">{lead.email || "-"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Phone</dt>
                      <dd className="truncate">{lead.phone || "-"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Source</dt>
                      <dd className="truncate">{lead.source}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Delivery</dt>
                      <dd className="truncate">{lead.delivery}</dd>
                    </div>
                  </dl>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Quality</span>
                    <LeadQualitySelect
                      leadId={lead.id}
                      workspaceId={access.workspaceId}
                      value={leadQualityValue(lead.quality)}
                      disabled={!canEditLeadQuality}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function MetricStat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-sm font-medium">{label}</span>
          <Icon aria-hidden className="size-4" />
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

function LeadStatusBadge({ duplicate }: { duplicate: boolean }) {
  return duplicate ? (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
      Possible duplicate
    </Badge>
  ) : (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
      New
    </Badge>
  );
}

function leadQualityValue(value: string | null | undefined): LeadQualityValue {
  return value === "valid" || value === "invalid" || value === "high_intent" ? value : "unlabelled";
}
