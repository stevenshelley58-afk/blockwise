import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadOperatorCustomerDetail } from "@/lib/operator/customers";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { CustomerActions } from "./customer-actions";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ workspaceId: string }> };

const detailSections = [
  ["overview", "Overview"],
  ["activation", "Activation"],
  ["billing", "Billing"],
  ["credits", "Credits"],
  ["brand", "Brand Pack"],
  ["meta", "Meta & campaigns"],
  ["team", "Team"],
  ["bookings", "Bookings"],
  ["audit", "Audit"],
] as const;

export default async function OperatorCustomerDetailPage({ params }: PageProps) {
  await requirePageSurfaceAccess("operator");
  const { workspaceId } = await params;
  const detail = await loadOperatorCustomerDetail({
    workspaceId,
    serviceSupabase: createSupabaseServiceClient(),
  });
  if (!detail) notFound();
  const { summary } = detail;

  return (
    <main className="content customer-ops-surface">
      <PageHeading
        eyebrow="Customer operations"
        title={summary.workspaceName}
        description={`${summary.customerName}${summary.customerEmail ? ` · ${summary.customerEmail}` : ""} · ${summary.country}`}
        actions={<Link className="button secondary" href="/operator/customers">Back to customers</Link>}
      />

      <nav className="panel customer-ops-detail-nav" aria-label="Customer detail sections">
        {detailSections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
      </nav>

      <section className="grid cols-3" id="overview">
        <article className="item-card">
          <h3>Next action</h3>
          <strong>{summary.nextAction}</strong>
          <p className="item-meta">{summary.lifecycleStage}</p>
        </article>
        <article className="item-card">
          <h3>Plan and billing</h3>
          <strong>{summary.plan}</strong>
          <p><StatusPill tone={summary.billingState.toLowerCase().includes("fail") ? "rose" : "amber"}>{summary.billingState}</StatusPill></p>
        </article>
        <article className="item-card">
          <h3>Assistance</h3>
          <strong>{summary.bookingState}</strong>
          <p className="item-meta">{summary.riskState}</p>
        </article>
      </section>

      <CustomerActions workspaceId={workspaceId} />

      <DetailPanel id="activation" title="Activation timeline">
        <KeyValueTable rows={timestampEntries(detail.activation ?? {})} empty="No activation record is available." />
      </DetailPanel>

      <DetailPanel id="billing" title="Billing and subscription">
        <KeyValueTable rows={selectedEntries(detail.workspace, ["billing_", "stripe_", "country_code", "billing_currency"])} empty="No billing state is available." />
      </DetailPanel>

      <DetailPanel id="credits" title="Credit wallets and ledger">
        <RecordTable
          rows={[...detail.wallets, ...detail.creditLedger]}
          columns={["entry_type", "entitlement_type", "quantity", "purpose", "credits_granted", "credits_reserved", "credits_consumed", "period_end", "created_at"]}
          empty="No credit wallet or ledger entries are available."
        />
      </DetailPanel>

      <DetailPanel id="brand" title="Brand Pack">
        <RecordTable rows={detail.brandPacks} columns={["source_url", "review_status", "created_at", "updated_at"]} empty="No Brand Pack has been started." />
      </DetailPanel>

      <DetailPanel id="meta" title="Meta connections, publish plans, and campaigns">
        <RecordTable
          rows={[...detail.providerConnections, ...detail.publishPlans, ...detail.campaigns]}
          columns={["provider", "external_account_name", "status", "name", "estimated_cost_cents", "created_at", "updated_at"]}
          empty="No Meta connection or campaign activity is available."
        />
      </DetailPanel>

      <DetailPanel id="team" title="Team">
        <RecordTable rows={detail.members.map(normalizeMember)} columns={["role", "name", "email", "created_at"]} empty="No team members are visible." />
      </DetailPanel>

      <DetailPanel id="bookings" title="Bookings and assistance">
        <RecordTable
          rows={detail.bookings}
          columns={["provider", "status", "scheduled_start_at", "scheduled_end_at", "booked_at", "completed_at", "reminder_24h_sent_at", "reminder_pre_session_sent_at"]}
          empty="No onboarding booking has been recorded."
        />
      </DetailPanel>

      <DetailPanel id="audit" title="Audit history">
        <RecordTable
          rows={detail.audit}
          columns={["created_at", "action", "target_type", "target_id", "actor_profile_id", "correlation_id"]}
          empty="No audit events are visible for this workspace."
        />
      </DetailPanel>
    </main>
  );
}

function DetailPanel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section className="panel customer-ops-detail-section" id={id}><h2>{title}</h2>{children}</section>;
}

function KeyValueTable({ rows, empty }: { rows: Array<[string, unknown]>; empty: string }) {
  if (!rows.length) return <p className="item-meta">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="table responsive-card-table"><tbody>
        {rows.map(([label, value]) => <tr key={label}><td data-label="Field"><strong>{humanize(label)}</strong></td><td data-label="Value">{formatValue(value)}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function RecordTable({ rows, columns, empty }: { rows: Record<string, unknown>[]; columns: string[]; empty: string }) {
  if (!rows.length) return <p className="item-meta">{empty}</p>;
  const visible = columns.filter((column) => rows.some((row) => row[column] !== undefined && row[column] !== null));
  return (
    <div className="table-wrap">
      <table className="table responsive-card-table">
        <thead><tr>{visible.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={String(row.id ?? `${index}-${row.created_at ?? ""}`)}>
            {visible.map((column) => <td data-label={humanize(column)} key={column}>{formatValue(row[column])}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function timestampEntries(row: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(row).filter(([key, value]) => key.endsWith("_at") && value);
}

function selectedEntries(row: Record<string, unknown>, keys: string[]): Array<[string, unknown]> {
  return Object.entries(row).filter(([key, value]) => value !== null && keys.some((candidate) => key === candidate || key.startsWith(candidate)));
}

function normalizeMember(row: Record<string, unknown>) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const record = profile && typeof profile === "object" ? profile as Record<string, unknown> : {};
  return { ...row, name: record.full_name, email: record.email };
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "Available in source system";
  const stringValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(stringValue)) {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(stringValue));
  }
  return stringValue;
}
