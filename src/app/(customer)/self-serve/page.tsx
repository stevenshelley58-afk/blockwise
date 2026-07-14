import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  builtInAdStudioTemplates,
  type AdStudioTemplate,
} from "@/lib/adstudio";

import "./self-serve.css";

export const dynamic = "force-dynamic";

type TemplateWithThumbnail = AdStudioTemplate & {
  sample: AdStudioTemplate["sample"];
};

// The gallery holds only eye-approved templates now (the look-alike set was
// deleted, not archived — Steven's call). Cards resolve defensively: missing
// ids simply don't render, so this list can lead the gallery, never crash it.
const FEATURED_TEMPLATE_CARDS = [
  { id: "meta-feed-020", label: "Just listed" },
];

function hasTemplateThumbnail(
  template: AdStudioTemplate | undefined,
): template is TemplateWithThumbnail {
  return Boolean(template?.sample?.thumbnailSrc);
}

function templateHref(template: AdStudioTemplate) {
  return `/ad-studio?first=1&template=${encodeURIComponent(
    template.id,
  )}`;
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
      .select("business_name")
      .eq("workspace_id", access.workspaceId)
      .limit(1),
    supabase
      .from("provider_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspaceId)
      .neq("status", "revoked"),
  ]);

  const businessName = (brandKits.data ?? [])
    .map((kit) => kit.business_name)
    .find((name) => name && name.trim() !== "")
    ?.trim();
  const hasBrand = Boolean(businessName);
  const hasProvider = (connections.count ?? 0) > 0;
  const hasAd = (campaigns.count ?? 0) > 0;
  const greeting = businessName
    ? `Welcome back, ${businessName}.`
    : "Welcome back.";

  const steps = [
    {
      id: "brand",
      n: 1,
      title: "Brand",
      href: "/ad-studio/brand",
      complete: hasBrand,
    },
    {
      id: "connect",
      n: 2,
      title: "Connect",
      href: "/settings#connections",
      complete: hasProvider,
    },
    {
      id: "create",
      n: 3,
      title: "Create ad",
      href: "/ad-studio?first=1",
      complete: hasAd,
    },
  ];

  const completedCount = steps.filter((step) => step.complete).length;
  const remainingSteps = steps.filter((step) => !step.complete);
  const nextStep = remainingSteps[0] ?? steps[steps.length - 1];
  const setupComplete = remainingSteps.length === 0;
  const templatesById = new Map(
    builtInAdStudioTemplates().map((template) => [template.id, template]),
  );
  const featuredTemplates = FEATURED_TEMPLATE_CARDS.flatMap((card) => {
    const template = templatesById.get(card.id);
    return hasTemplateThumbnail(template) ? [{ ...card, template }] : [];
  });
  const showTemplateCarousel =
    featuredTemplates.length > 0 && (setupComplete || nextStep.id === "create");

  return (
    <>
      <ConfirmRegistrationTracker />
      <main className="bw-hub" aria-label="Self-serve setup">
        <header className="bwh-header">
          <h1 className="bwh-title">{greeting}</h1>
          <Link className="bwh-btn bwh-btn-dark" href="/ad-studio?first=1">
            <span>Create ad</span>
            <ArrowRight aria-hidden size={17} strokeWidth={2.3} />
          </Link>
        </header>

        <section
          className="bwh-setup"
          aria-labelledby="setup-title"
          aria-label={`Setup progress: ${completedCount} of ${steps.length} complete`}
        >
          <div className="bwh-setup-head">
            <p className="bwh-eyebrow" id="setup-title">
              Setup
            </p>
            <span className="bwh-progress-dots" aria-hidden="true">
              {steps.map((step) => (
                <i
                  key={step.id}
                  className={
                    step.complete
                      ? "is-done"
                      : step.id === nextStep.id
                        ? "is-current"
                        : undefined
                  }
                />
              ))}
            </span>
          </div>

          <div className="bwh-setup-tiles" role="list">
            {steps.map((step) => (
              <Link
                key={step.id}
                href={step.href}
                role="listitem"
                className={[
                  "bwh-step-tile",
                  step.complete ? "bwh-step-tile-done" : "",
                  !step.complete && step.id === nextStep.id
                    ? "bwh-step-tile-current"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={`${step.title}${
                  step.complete
                    ? " complete"
                    : step.id === nextStep.id
                      ? " next"
                      : ""
                }`}
              >
                <span className="bwh-tile-top">
                  <span className="bwh-step-dot">
                    {step.complete ? (
                      <Check aria-hidden size={14} strokeWidth={2.4} />
                    ) : (
                      step.n
                    )}
                  </span>
                  {!step.complete && step.id === nextStep.id ? (
                    <ArrowRight
                      aria-hidden
                      className="bwh-tile-arrow"
                      size={15}
                      strokeWidth={2.3}
                    />
                  ) : null}
                </span>
                <strong>{step.title}</strong>
              </Link>
            ))}
          </div>
        </section>

        {showTemplateCarousel ? (
          <section className="bwh-templates" aria-labelledby="templates-title">
            <div className="bwh-template-head">
              <p className="bwh-eyebrow" id="templates-title">
                Templates
              </p>
              <span>Swipe</span>
            </div>
            <div className="bwh-template-rail" role="list">
              {featuredTemplates.map(({ label, template }) => (
                <Link
                  key={template.id}
                  href={templateHref(template)}
                  className="bwh-template-card"
                  role="listitem"
                  aria-label={`Use ${template.name}`}
                >
                  <span className="bwh-template-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={template.sample.thumbnailSrc}
                      alt=""
                      loading="lazy"
                    />
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
    </>
  );
}
