import Link from "next/link";
import { CalendarClock, CreditCard, Search, TriangleAlert, UsersRound } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  CUSTOMER_QUEUE_KEYS,
  CUSTOMER_QUEUE_LABELS,
  loadOperatorCustomers,
  type CustomerQueueKey,
} from "@/lib/operator/customers";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ queue?: string; q?: string }>;
};

export default async function OperatorCustomersPage({ searchParams }: PageProps) {
  await requirePageSurfaceAccess("operator");
  const params = await searchParams;
  const selectedQueue = CUSTOMER_QUEUE_KEYS.includes(params.queue as CustomerQueueKey)
    ? params.queue as CustomerQueueKey
    : "all";
  const customers = await loadOperatorCustomers({
    query: params.q,
    queue: selectedQueue,
    serviceSupabase: createSupabaseServiceClient(),
  });

  return (
    <main className="content customer-ops-surface">
      <PageHeading
        eyebrow="Customer operations"
        title="Customers"
        description="Prioritise activation blockers, review authoritative customer state, and make audited service interventions without editing raw records."
      />

      <section className="grid cols-4" aria-label="Customer operations metrics">
        <MetricCard icon={UsersRound} label="Customers" value={String(customers.queueCounts.all)} note="Operator-visible workspaces" />
        <MetricCard icon={CalendarClock} label="Paid, no booking" value={String(customers.queueCounts.paid_no_booking)} note="Needs onboarding follow-up" />
        <MetricCard icon={CreditCard} label="Payment failed" value={String(customers.queueCounts.payment_failed)} note="Needs billing recovery" />
        <MetricCard icon={TriangleAlert} label="Publish failed" value={String(customers.queueCounts.publish_failed)} note="Needs launch assistance" />
      </section>

      <section className="panel customer-ops-queues" aria-labelledby="priority-queues-title">
        <div className="row-between">
          <div>
            <h2 id="priority-queues-title">Priority queues</h2>
            <p className="item-meta">Counts stay visible even when another queue is selected.</p>
          </div>
          <form className="customer-ops-search" method="get" action="/operator/customers">
            {selectedQueue !== "all" ? <input type="hidden" name="queue" value={selectedQueue} /> : null}
            <label htmlFor="customer-search">Search customers</label>
            <div>
              <Search aria-hidden size={16} />
              <input id="customer-search" name="q" defaultValue={params.q ?? ""} placeholder="Workspace, owner, or email" />
            </div>
            <button className="button secondary" type="submit">Search</button>
          </form>
        </div>
        <nav className="customer-ops-filter-list" aria-label="Customer priority queues">
          {CUSTOMER_QUEUE_KEYS.map((queue) => (
            <Link
              className={selectedQueue === queue ? "customer-ops-filter active" : "customer-ops-filter"}
              href={`/operator/customers?queue=${queue}`}
              aria-current={selectedQueue === queue ? "page" : undefined}
              key={queue}
            >
              <span>{CUSTOMER_QUEUE_LABELS[queue]}</span>
              <strong>{customers.queueCounts[queue]}</strong>
            </Link>
          ))}
        </nav>
      </section>

      <section className="panel">
        <div className="row-between">
          <div>
            <h2>{CUSTOMER_QUEUE_LABELS[selectedQueue]}</h2>
            <p className="item-meta">{customers.rows.length} customer{customers.rows.length === 1 ? "" : "s"} in this view.</p>
          </div>
        </div>
        {customers.rows.length ? (
          <div className="table-wrap">
            <table className="table responsive-card-table">
              <thead>
                <tr>
                  <th>Customer / workspace</th>
                  <th>Stage / next action</th>
                  <th>Plan / billing</th>
                  <th>Credits</th>
                  <th>Brand / Meta</th>
                  <th>Booking</th>
                  <th>Last activity</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {customers.rows.map((row) => (
                  <tr key={row.workspaceId}>
                    <td data-label="Customer / workspace">
                      <Link className="customer-ops-customer-link" href={`/operator/customers/${row.workspaceId}`}>
                        <strong>{row.workspaceName}</strong>
                        <span>{row.customerName}{row.customerEmail ? ` · ${row.customerEmail}` : ""}</span>
                        <small>{row.country}</small>
                      </Link>
                    </td>
                    <td data-label="Stage / next action"><strong>{row.lifecycleStage}</strong><br /><span className="item-meta">{row.nextAction}</span></td>
                    <td data-label="Plan / billing">{row.plan}<br /><StatusPill tone={billingTone(row.billingState)}>{row.billingState}</StatusPill></td>
                    <td data-label="Credits">{row.creditsRemaining ?? "—"}</td>
                    <td data-label="Brand / Meta">{row.brandPackState}<br /><span className="item-meta">{row.metaState} · Free live {row.freeLiveState}</span></td>
                    <td data-label="Booking"><StatusPill tone={bookingTone(row.bookingState)}>{row.bookingState}</StatusPill></td>
                    <td data-label="Last activity">{formatDate(row.lastActivityAt)}</td>
                    <td data-label="Review"><StatusPill tone={row.riskState === "Normal" ? "green" : "amber"}>{row.riskState}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="customer-ops-empty">
            <h3>No customers in this queue</h3>
            <p>Try another priority queue or clear the customer search.</p>
            <Link className="button secondary" href="/operator/customers">View all customers</Link>
          </div>
        )}
      </section>
    </main>
  );
}

function billingTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (normalized.includes("active") || normalized.includes("paid")) return "green";
  if (normalized.includes("fail") || normalized.includes("recovery")) return "rose";
  return "amber";
}

function bookingTone(value: string): StatusTone {
  if (value === "completed" || value === "booked" || value === "rescheduled") return "green";
  if (value === "cancelled" || value === "failed") return "rose";
  return "amber";
}

function formatDate(value: string | null): string {
  if (!value) return "No activity";
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
