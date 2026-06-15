import { Gauge, PlugZap, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { ModelControlPanel } from "@/components/model-control-panel";
import { PageHeading } from "@/components/page-heading";
import { PromptControlPanel } from "@/components/prompt-control-panel";
import { StatusPill } from "@/components/status-pill";
import { getModelControlViewData } from "@/lib/ai/model-profile-store";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listAiLedgerRows, type AiLedgerFilters } from "@/lib/operator/overview";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;

export default async function ModelControlPage({ searchParams }: { searchParams?: SearchParams }) {
  const { access } = await requirePageSurfaceAccess("operator");
  const supabase = await createSupabaseServerClient();
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const ledgerFilters: AiLedgerFilters = {
    userId: firstParam(params.userId),
    model: firstParam(params.model),
    task: firstParam(params.task),
    day: firstParam(params.day),
  };
  const modelControlData = await getModelControlViewData(supabase);
  const ledgerRows = await listAiLedgerRows(supabase, access.isOperator ? undefined : access.workspaceId, ledgerFilters);
  const profileCount = new Set(
    modelControlData.sections.flatMap((section) => section.profiles.map((profile) => profile.key)),
  ).size;
  const configuredProviderNames = Array.from(
    new Set(
      modelControlData.modelProfiles.flatMap((profile) => [
        profile.primary.provider,
        ...profile.fallbacks.map((fallback) => fallback.provider),
      ]),
    ),
  ).map(formatProviderName);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Model governance"
        title="Model Control"
        description="Task-specific model profiles keep provider choices, fallbacks, spend limits, structured-output requirements, image settings, and kill switches out of product code."
      />

      <section className="grid cols-4">
        <MetricCard icon={SlidersHorizontal} label="Profiles" value={String(profileCount)} note="Configured by task" />
        <MetricCard icon={PlugZap} label="Providers" value={String(configuredProviderNames.length)} note={formatProviderList(configuredProviderNames)} />
        <MetricCard icon={Gauge} label="Spend caps" value="On" note="Per-run cost policy and ledger" />
        <MetricCard icon={ShieldCheck} label="Structured output" value="Required" note="For classifications and compliance reviews" />
      </section>

      <ModelControlPanel initialData={modelControlData} />

      <PromptControlPanel />

      <section className="panel">
        <h2>Ledger Requirements</h2>
        <div className="grid cols-3">
          {["workspace", "user", "task", "provider", "model", "usage", "estimated cost", "output type", "result"].map((field) => (
            <article className="item-card" key={field}>
              <h3>{field}</h3>
              <p className="item-meta">Stored for every model run and reviewable in the Operator Console.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Usage Ledger</h2>
        <form className="grid cols-4 ledger-filter-form" method="get">
          <label>
            <span>User</span>
            <input name="userId" defaultValue={ledgerFilters.userId ?? ""} placeholder="User id" />
          </label>
          <label>
            <span>Model</span>
            <input name="model" defaultValue={ledgerFilters.model ?? ""} placeholder="gpt-4.1" />
          </label>
          <label>
            <span>Task</span>
            <input name="task" defaultValue={ledgerFilters.task ?? ""} placeholder="adstudio.copy" />
          </label>
          <label>
            <span>Day</span>
            <input name="day" type="date" defaultValue={ledgerFilters.day ?? ""} />
          </label>
          <div className="actions">
            <button className="button" type="submit">
              Filter
            </button>
            <a className="button secondary" href="/model-control">
              Clear
            </a>
          </div>
        </form>
        <div className="table-wrap">
          <table className="table responsive-card-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Task</th>
                <th>Profile</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Status</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Time">{formatDate(row.createdAt)}</td>
                  <td data-label="User">{row.user}</td>
                  <td data-label="Task">{row.task}</td>
                  <td data-label="Profile">{row.profile}</td>
                  <td data-label="Provider">{row.provider}</td>
                  <td data-label="Model">{row.model}</td>
                  <td data-label="Status">
                    <StatusPill tone={row.result === "completed" ? "green" : "rose"}>{row.result}</StatusPill>
                  </td>
                  <td data-label="Cost">{row.estimatedCost}</td>
                </tr>
              ))}
              {!ledgerRows.length ? (
                <tr>
                  <td colSpan={8}>No usage rows match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed || undefined;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatProviderName(provider: string): string {
  if (provider === "openai") return "Primary provider";
  if (provider === "openrouter") return "Routing provider";

  return provider;
}

function formatProviderList(providers: string[]): string {
  if (providers.length === 0) {
    return "No providers configured";
  }

  return providers.join(", ");
}
