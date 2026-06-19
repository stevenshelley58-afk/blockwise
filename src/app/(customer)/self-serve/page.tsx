import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

import "./self-serve.css";

export const dynamic = "force-dynamic";

type Step = {
  id: string;
  n: number;
  title: string;
  description: string;
  href: string;
  complete: boolean;
};

export default async function SelfServePage() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");

  const [campaigns, brandKits, connections] = await Promise.all([
    supabase.from("adstudio_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", access.workspaceId),
    supabase.from("adstudio_brand_kits").select("business_name").eq("workspace_id", access.workspaceId).limit(1),
    supabase
      .from("provider_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspaceId)
      .neq("status", "revoked"),
  ]);

  const businessName = (brandKits.data ?? []).map((k) => k.business_name).find((n) => n && n.trim() !== "")?.trim();
  const hasAd = (campaigns.count ?? 0) > 0;
  const hasBrand = Boolean(businessName);
  const hasConnection = (connections.count ?? 0) > 0;

  const steps: Step[] = [
    {
      id: "brand",
      n: 1,
      title: "Brand identity",
      description: "Logo, colours and voice so every ad looks unmistakably yours.",
      href: "/ad-studio/brand",
      complete: hasBrand,
    },
    {
      id: "connect",
      n: 2,
      title: "Connect channels",
      description: "Link Meta once — you only need it when an approved ad is ready to publish.",
      href: "/settings#connections",
      complete: hasConnection,
    },
    {
      id: "create",
      n: 3,
      title: "Create & launch",
      description: "Drop in a listing photo, approve the copy, and generate Story, Feed and Square.",
      href: "/ad-studio?first=1",
      complete: hasAd,
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const progress = Math.round((completedCount / steps.length) * 100);
  const nextStep = steps.find((s) => !s.complete) ?? steps[steps.length - 1];
  const greeting = businessName ? `Welcome back, ${businessName}.` : "Welcome back.";

  return (
    <main className="content bw-hub">
      <ConfirmRegistrationTracker />

      <h1 className="bwh-title">{greeting}</h1>
      <p className="bwh-lede">
        You&rsquo;re a few short steps from your first live ad. Bring one image and a few words — Blockwise handles the
        targeting, sizing and formats.
      </p>
      <div className="bwh-actions">
        <Link className="bwh-btn bwh-btn-dark" href="/ad-studio?first=1">
          Launch your first ad
          <ArrowRight aria-hidden size={16} />
        </Link>
        <Link className="bwh-btn bwh-btn-ghost" href="/ad-studio">
          View templates
        </Link>
      </div>

      <div className="bwh-banner">
        <div>
          <h3>Fastest path to your first ad</h3>
          <p>Most listings go live in under 4 minutes. Pick up where you left off.</p>
        </div>
        <Link className="bwh-btn bwh-btn-light" href={nextStep.href}>
          {completedCount === steps.length ? "Create another ad" : "Resume setup"}
        </Link>
      </div>

      <p className="bwh-eyebrow">Setup — {completedCount} of {steps.length} complete</p>
      <div className="bwh-progress-wrap">
        <div className="bwh-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
        <span className="bwh-muted">{progress}%</span>
      </div>

      <div className="bwh-steps">
        {steps.map((step) => {
          const isNext = !step.complete && step.id === nextStep.id;
          return (
            <Link
              key={step.id}
              href={step.href}
              className={`bwh-step${step.complete ? " bwh-done" : ""}`}
            >
              {step.complete ? (
                <span className="bwh-tag bwh-tag-done">Done</span>
              ) : isNext ? (
                <span className="bwh-tag bwh-tag-now">Next</span>
              ) : null}
              <span className="bwh-n">{step.complete ? <Check aria-hidden size={16} /> : step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
