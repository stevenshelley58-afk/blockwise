import { ArrowRight, Check, Clock3, Home, Info, Target } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

import "./self-serve.css";

export const dynamic = "force-dynamic";

const INCLUDED_AD_PACKS = 10;

function initialsFor(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }

  return (words[0]?.slice(0, 2) || "BW").toUpperCase();
}


export default async function SelfServeHome() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");

  const [campaigns, brandKits, connections] = await Promise.all([
    supabase
      .from("adstudio_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspaceId),
    supabase
      .from("adstudio_brand_kits")
      .select("business_name, colours_json")
      .eq("workspace_id", access.workspaceId)
      .limit(1),
    supabase
      .from("provider_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspaceId)
      .neq("status", "revoked"),
  ]);

  const brandKit = brandKits.data?.[0] ?? null;
  const workspaceName = access.workspaceName?.trim() || "Workspace";
  const displayName = brandKit?.business_name?.trim() || workspaceName;
  const roleTitle = "Real estate agent";
  const region = access.region ?? "AU";
  const hasBrand = Boolean(brandKit?.business_name?.trim());
  const hasProvider = (connections.count ?? 0) > 0;
  const usedAdPacks = Math.max(0, campaigns.count ?? 0);
  const remainingAdPacks = Math.max(0, INCLUDED_AD_PACKS - usedAdPacks);

  const steps = [
    {
      id: "brand",
      n: 1,
      title: "Brand pack",
      href: "/ad-studio/brand",
      complete: hasBrand,
      status: hasBrand ? "Complete" : "In progress",
    },
    {
      id: "connect",
      n: 2,
      title: "Connect Meta",
      href: "/settings#connections",
      complete: hasProvider,
      status: hasProvider ? "Connected" : "Not started",
    },
    {
      id: "publish",
      n: 3,
      title: "Publish an ad",
      href: "/ad-studio?first=1",
      complete: usedAdPacks > 0,
      status: usedAdPacks > 0 ? "Published" : "Ready after setup",
    },
  ];
  const nextStep = steps.find((step) => !step.complete) ?? steps[steps.length - 1];
  const colours = brandKit?.colours_json && typeof brandKit.colours_json === "object" ? brandKit.colours_json as Record<string, unknown> : {};
  const brandColors = [
    typeof colours.primary === "string" ? colours.primary : "#07152b",
    typeof colours.secondary === "string" ? colours.secondary : "#315ca8",
    typeof colours.accent === "string" ? colours.accent : "#e8e8e8",
  ];

  return (
    <>
      <ConfirmRegistrationTracker />
      <main className="bw-hub" aria-label="Self-serve overview">
        <section className="bwh-hero" aria-labelledby="self-serve-title">
          <h1 className="bwh-title" id="self-serve-title">
            Let’s get your first ad live.
          </h1>
          <p className="bwh-subtitle">Complete your brand once. Blockwise handles the rest.</p>
        </section>

        <section className="bwh-opening-grid" aria-label="Opening setup actions">
          <article className="bwh-card bwh-brand-card">
            <div>
              <h2>Build your brand pack</h2>
              <p>Add your logo, colours and key details. We&apos;ll turn it into an ad-ready brand pack.</p>
            </div>
            <div className="bwh-brand-preview">
              <div className="bwh-logo-tile" aria-hidden="true">{initialsFor(displayName)}</div>
              <div className="bwh-brand-meta">
                <strong>{displayName}</strong>
                <span>{roleTitle}</span>
                <div className="bwh-swatches" aria-label="Brand colours">
                  {brandColors.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="bwh-card-footer">
              <span className="bwh-time"><Clock3 aria-hidden size={18} />4 minutes</span>
              <Link className="bwh-btn bwh-btn-dark" href="/ad-studio/brand">
                Complete brand setup <ArrowRight aria-hidden size={18} />
              </Link>
            </div>
          </article>

          <article className="bwh-card bwh-progress-card" aria-labelledby="setup-progress-title">
            <h2 id="setup-progress-title">Setup progress</h2>
            <ol className="bwh-progress-list">
              {steps.map((step) => (
                <li key={step.id} className={step.id === nextStep.id ? "is-current" : step.complete ? "is-done" : undefined}>
                  <Link href={step.href}>
                    <span className="bwh-step-number">{step.complete ? <Check aria-hidden size={16} /> : step.n}</span>
                    <strong>{step.title}</strong>
                    <em>{step.status}</em>
                  </Link>
                </li>
              ))}
            </ol>
          </article>
        </section>

        <section className="bwh-action-grid" aria-label="Next actions">
          <article className="bwh-card bwh-mini-card">
            <div>
              <h2>See what agents run nearby</h2>
              <p>Find top-performing ads from agents in your area.</p>
            </div>
            <div className="bwh-mini-bottom">
              <Link className="bwh-btn bwh-btn-outline" href="/ad-radar">Open Ad Radar <ArrowRight aria-hidden size={16} /></Link>
              <span className="bwh-icon-orb"><Target aria-hidden size={34} /></span>
            </div>
          </article>

          <article className="bwh-card bwh-mini-card">
            <div>
              <h2>Check a property</h2>
              <p>Get instant insights and ad ideas for any listing.</p>
            </div>
            <div className="bwh-mini-bottom">
              <Link className="bwh-btn bwh-btn-outline" href="/property-check">Check property <ArrowRight aria-hidden size={16} /></Link>
              <span className="bwh-icon-orb"><Home aria-hidden size={34} /></span>
            </div>
          </article>

          <article className="bwh-card bwh-status-card">
            <h2>Workspace status</h2>
            <dl>
              <div><dt><Check aria-hidden size={16} />Workspace</dt><dd>{workspaceName} - {region}</dd></div>
              <div><dt><Check aria-hidden size={16} />Plan</dt><dd>Free</dd></div>
              <div><dt><Info aria-hidden size={16} />Ad packs</dt><dd>{remainingAdPacks} / {INCLUDED_AD_PACKS} free left <Link href="/settings#billing">Upgrade</Link></dd></div>
            </dl>
          </article>
        </section>
      </main>
    </>
  );
}
