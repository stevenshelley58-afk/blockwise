import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { builtInAdStudioTemplates, type AdStudioTemplate } from "@/lib/adstudio";

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

type TemplateWithThumbnail = AdStudioTemplate & { gallery: NonNullable<AdStudioTemplate["gallery"]> };

const FEATURED_TEMPLATE_CARDS = [
  { id: "meta-feed-008", label: "Prestige" },
  { id: "meta-feed-002", label: "Value" },
  { id: "meta-feed-010", label: "Open home" },
  { id: "meta-feed-014", label: "Sold" },
  { id: "meta-fullscreen-002", label: "Agent" },
  { id: "meta-fullscreen-006", label: "Market" },
  { id: "meta-fullscreen-001", label: "PM" },
];

function hasTemplateThumbnail(template: AdStudioTemplate | undefined): template is TemplateWithThumbnail {
  return Boolean(template?.gallery?.thumbnailSrc);
}

function templateHref(template: AdStudioTemplate) {
  return `/ad-studio?first=1&template=${encodeURIComponent(template.templateKey ?? template.id)}`;
}

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
  const remainingSteps = steps.filter((s) => !s.complete);
  const nextStep = remainingSteps[0] ?? steps[steps.length - 1];
  const setupComplete = remainingSteps.length === 0;
  const greeting = businessName ? `Welcome back, ${businessName}.` : "Welcome back.";
  const templatesById = new Map(builtInAdStudioTemplates().map((template) => [template.id, template]));
  const featuredTemplates = FEATURED_TEMPLATE_CARDS.flatMap((card) => {
    const template = templatesById.get(card.id);
    return hasTemplateThumbnail(template) ? [{ ...card, template }] : [];
  });
  const showTemplateCarousel = featuredTemplates.length > 0 && (setupComplete || nextStep.id === "create");

  return (
    <main className="content bw-hub">
      <ConfirmRegistrationTracker />

      <header className="bwh-header">
        <h1 className="bwh-title">{greeting}</h1>
        <Link className="bwh-btn bwh-btn-dark" href={nextStep.href}>
          {setupComplete ? "Create another ad" : "Continue setup"}
          <ArrowRight aria-hidden size={16} />
        </Link>
      </header>

      <section className="bwh-setup" aria-labelledby="setup-progress-title">
        <div className="bwh-setup-head">
          <p className="bwh-eyebrow" id="setup-progress-title">Setup progress</p>
          <span className="bwh-muted">{completedCount} of {steps.length} complete</span>
        </div>
        <ol className="bwh-stepper" aria-label={`Setup progress: ${completedCount} of ${steps.length} complete`}>
          {steps.map((step) => (
            <li
              key={step.id}
              className={[
                "bwh-stepper-item",
                step.complete ? "bwh-stepper-done" : "",
                !step.complete && step.id === nextStep.id ? "bwh-stepper-current" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className="bwh-stepper-segment" aria-hidden="true" />
              <span className="bwh-stepper-meta">
                <span className="bwh-stepper-dot">{step.complete ? <Check aria-hidden size={14} /> : step.n}</span>
                <span className="bwh-stepper-label">{step.title}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="bwh-remaining" aria-labelledby="remaining-setup-title">
        <p className="bwh-eyebrow" id="remaining-setup-title">{setupComplete ? "Ready" : "Left to do"}</p>
        {setupComplete ? (
          <div className="bwh-complete">
            <h2>Your setup is ready.</h2>
            <p>Create a new ad or refine an existing campaign from Ad Studio.</p>
            <Link className="bwh-btn bwh-btn-ghost" href="/ad-studio">
              Open Ad Studio
              <ArrowRight aria-hidden size={16} />
            </Link>
          </div>
        ) : (
          <div className="bwh-task-list">
            {remainingSteps.map((step, index) => (
              <Link key={step.id} href={step.href} className={index === 0 ? "bwh-task bwh-task-next" : "bwh-task"}>
                <span className="bwh-task-kicker">{index === 0 ? "Next" : `Step ${step.n}`}</span>
                <span className="bwh-task-copy">
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </span>
                <ArrowRight aria-hidden size={17} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {showTemplateCarousel ? (
        <section className="bwh-templates" aria-labelledby="template-carousel-title">
          <div className="bwh-template-head">
            <p className="bwh-eyebrow" id="template-carousel-title">Templates</p>
            <span className="bwh-muted">Swipe to choose</span>
          </div>
          <div className="bwh-template-rail" role="list">
            {featuredTemplates.map(({ label, template }) => (
              <Link key={template.id} href={templateHref(template)} className="bwh-template-card" role="listitem" aria-label={`Use ${template.name}`}>
                <span className="bwh-template-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={template.gallery.thumbnailSrc} alt="" loading="lazy" />
                </span>
                <span className="bwh-template-meta">
                  <strong>{label}</strong>
                  <span>Use</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
