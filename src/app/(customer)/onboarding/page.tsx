import { Link2, MapPinned, Palette, ShieldCheck, UserRoundCog } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { onboardingSteps, workspace } from "@/lib/product/demo-data";

export default function OnboardingPage() {
  return (
    <main className="content">
      <PageHeading
        eyebrow="Secure setup"
        title="Onboarding"
        description="Assign plan and mode, capture agency profile, set suburbs and brand rules, then connect Meta and Google with sync-health checks."
      />

      <section className="grid cols-4">
        <MetricCard icon={UserRoundCog} label="Plan" value={workspace.plan} note="Admin assigned for v1" />
        <MetricCard icon={MapPinned} label="Suburbs" value={String(workspace.suburbs.length)} note={workspace.suburbs.join(", ")} />
        <MetricCard icon={Palette} label="Brand" value="Draft" note="Logo, colours, tone, and exclusions" />
        <MetricCard icon={Link2} label="Connections" value="2" note="Meta connected, Google needs attention" />
      </section>

      <section className="split">
        <div className="panel">
          <h2>Workspace Setup</h2>
          <div className="timeline">
            {onboardingSteps.map((step) => (
              <div className="timeline-item" key={step.label}>
                <span className="timeline-dot" aria-hidden />
                <div>
                  <h3>{step.label}</h3>
                  <StatusPill tone={step.state.includes("Needs") ? "amber" : step.state === "In progress" ? "blue" : "green"}>
                    {step.state}
                  </StatusPill>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <ShieldCheck aria-hidden color="#2f7d32" size={28} />
          <h2>Security Foundation</h2>
          <p>
            The first release assumes Supabase Auth, workspace roles, RLS policies, storage isolation, encrypted provider tokens,
            audit logs, and rate limits before live publishing is enabled.
          </p>
          <StatusPill tone="green">RLS-first schema included</StatusPill>
        </div>
      </section>
    </main>
  );
}
