import { Gauge, PlugZap, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { ModelControlPanel } from "@/components/model-control-panel";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { getModelControlViewData } from "@/lib/ai/model-profile-store";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listAiLedgerRows } from "@/lib/product/live-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ModelControlPage() {
  const { access } = await requirePageSurfaceAccess("model_control");
  const supabase = await createSupabaseServerClient();
  const modelControlData = await getModelControlViewData(supabase);
  const ledgerRows = await listAiLedgerRows(supabase, access.workspaceId);
  const profileCount = new Set(
    modelControlData.sections.flatMap((section) => section.profiles.map((profile) => profile.key)),
  ).size;

  return (
    <main className="content">
      <PageHeading
        eyebrow="AI governance"
        title="Model Control"
        description="Task-specific model profiles keep provider choices, fallbacks, spend limits, structured-output requirements, image settings, and kill switches out of product code."
      />

      <section className="grid cols-4">
        <MetricCard icon={SlidersHorizontal} label="Profiles" value={String(profileCount)} note="Configured by task" />
        <MetricCard icon={PlugZap} label="Providers" value="2" note="OpenAI direct and OpenRouter routed" />
        <MetricCard icon={Gauge} label="Spend caps" value="On" note="Per-run cost policy and ledger" />
        <MetricCard icon={ShieldCheck} label="Structured output" value="Required" note="For classifications and compliance reviews" />
      </section>

      <ModelControlPanel initialData={modelControlData} />

      <section className="panel">
        <h2>Ledger Requirements</h2>
        <div className="grid cols-3">
          {["workspace", "user", "task", "provider", "model", "usage", "estimated cost", "output type", "result"].map((field) => (
            <article className="item-card" key={field}>
              <h3>{field}</h3>
              <p className="item-meta">Stored for every AI run and reviewable in the Operator Console.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>AI Usage Ledger</h2>
        <table className="table">
          <thead>
            <tr>
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
                <td>{row.task}</td>
                <td>{row.profile}</td>
                <td>{row.provider}</td>
                <td>{row.model}</td>
                <td>
                  <StatusPill tone={row.result === "completed" ? "green" : "rose"}>{row.result}</StatusPill>
                </td>
                <td>{row.estimatedCost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
