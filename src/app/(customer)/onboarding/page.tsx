import { ArrowRight, BadgeCheck, BarChart3, Link2, MapPinned, Palette, ShieldCheck, Sparkles, UserRoundCog } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/ui/metric-card";
import { PageHeading } from "@/ui/page-heading";
import { StatusPill } from "@/ui/status-pill";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";
import { onboardingSteps, workspace } from "@/modules/product/demo-data";

const activationTasks = [
  {
    title: "Workspace access",
    status: "Complete",
    tone: "green" as const,
    copy: `${workspace.plan} plan, ${workspace.region} region, and ${workspace.suburbs.length} suburbs are ready.`,
    cta: "Review setup",
    href: "/onboarding",
  },
  {
    title: "Provider data",
    status: "Needs attention",
    tone: "amber" as const,
    copy: "Meta is connected. Google needs a reconnect before live reporting is complete.",
    cta: "Fix Google sync",
    href: "/monitor",
  },
  {
    title: "Brand kit",
    status: "In progress",
    tone: "blue" as const,
    copy: "Approve logo, colours, tone, and exclusions so campaign generation has guardrails.",
    cta: "Approve brand",
    href: "/ad-studio#adstudio-live-controls",
  },
  {
    title: "First campaign pack",
    status: "Next",
    tone: "blue" as const,
    copy: "Generate the first seller-lead campaign pack, then export review-ready files.",
    cta: "Generate pack",
    href: "/ad-studio#adstudio-live-controls",
  },
];

const completedSteps = onboardingSteps.filter((step) => step.state === "Complete" || step.state === "Connected").length;
const progressPercent = Math.round((completedSteps / onboardingSteps.length) * 100);
const nextTask = activationTasks.find((task) => task.status !== "Complete") ?? activationTasks.at(-1);

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requirePageSurfaceAccess("monitor");

  return (
    <main className="content">
      <PageHeading
        eyebrow="First-run setup"
        title="Onboarding"
        description="Finish the shortest path from issued access to live reporting, approved brand rules, and a review-ready seller campaign."
      />

      {nextTask ? (
        <section className="panel onboarding-hero" aria-labelledby="onboarding-next-action">
          <div className="onboarding-hero-copy">
            <StatusPill tone={nextTask.tone}>Next action</StatusPill>
            <h2 id="onboarding-next-action">{nextTask.title}</h2>
            <p>{nextTask.copy}</p>
            <div className="actions">
              <Link className="button" href={nextTask.href}>
                {nextTask.cta}
                <ArrowRight aria-hidden size={17} />
              </Link>
              <Link className="button secondary" href="/monitor">
                View sample report
              </Link>
            </div>
          </div>
          <div className="onboarding-progress-panel" aria-label="Onboarding progress">
            <span>{progressPercent}% complete</span>
            <div className="onboarding-progress-track">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <p>{completedSteps} of {onboardingSteps.length} setup checks are done.</p>
          </div>
        </section>
      ) : null}

      <section className="grid cols-4">
        <MetricCard icon={Sparkles} label="Activation" value="Campaign pack" note="First review-ready seller campaign" />
        <MetricCard icon={UserRoundCog} label="Plan" value={workspace.plan} note="Assigned before first sign-in" />
        <MetricCard icon={MapPinned} label="Suburbs" value={String(workspace.suburbs.length)} note={workspace.suburbs.join(", ")} />
        <MetricCard icon={Link2} label="Connections" value="1 of 2" note="Meta connected, Google needs attention" />
      </section>

      <section className="onboarding-layout">
        <div className="panel">
          <div className="section-heading">
            <h2>Activation Checklist</h2>
            <StatusPill tone="blue">{completedSteps} done</StatusPill>
          </div>
          <div className="onboarding-checklist">
            {activationTasks.map((task, index) => (
              <article className={`onboarding-task ${task.status === "Complete" ? "complete" : ""}`} key={task.title}>
                <span className="onboarding-step-number">{index + 1}</span>
                <div>
                  <div className="onboarding-task-heading">
                    <h3>{task.title}</h3>
                    <StatusPill tone={task.tone}>{task.status}</StatusPill>
                  </div>
                  <p>{task.copy}</p>
                  <Link className="button secondary" href={task.href}>
                    {task.cta}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel onboarding-side-panel">
          <div>
            <ShieldCheck aria-hidden color="#2f7d32" size={28} />
            <h2>Guardrails</h2>
            <p>
              Workspace roles, RLS policies, provider-token vaulting, audit logs, and approval gates stay active before
              any publishing step.
            </p>
            <StatusPill tone="green">Publishing remains gated</StatusPill>
          </div>
          <div className="onboarding-next-list">
            <h3>First value path</h3>
            <p>
              <BarChart3 aria-hidden size={16} />
              See a report even while reconnects are pending.
            </p>
            <p>
              <Palette aria-hidden size={16} />
              Approve brand rules before generation.
            </p>
            <p>
              <BadgeCheck aria-hidden size={16} />
              Export a compliant pack for review.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
