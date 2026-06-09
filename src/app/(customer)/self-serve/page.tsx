import { ArrowRight, Palette, PenLine, Plug } from "lucide-react";
import Link from "next/link";

import { PageHeading } from "@/components/page-heading";
import { SetupChecklist, type SetupChecklistItem } from "@/components/self-serve/setup-checklist";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function SelfServePage() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");

  const [campaigns, brandKits, connections] = await Promise.all([
    supabase.from("adstudio_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", access.workspaceId),
    supabase.from("adstudio_brand_kits").select("name").eq("workspace_id", access.workspaceId).limit(1),
    supabase
      .from("provider_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspaceId)
      .neq("status", "revoked"),
  ]);

  const hasAd = (campaigns.count ?? 0) > 0;
  const hasBrand = (brandKits.data ?? []).some((kit) => kit.name && kit.name.trim() !== "");
  const hasConnection = (connections.count ?? 0) > 0;
  const checklist: SetupChecklistItem[] = [
    {
      id: "first-ad",
      label: "Create your first ad",
      description: "Use one image and a short brief to generate Story, Feed, and Square.",
      complete: hasAd,
      href: "/ad-studio?first=1",
    },
    {
      id: "brand",
      label: "Confirm your brand",
      description: "Add the basics so draft copy and colours feel like your agency.",
      complete: hasBrand,
      href: "/onboarding",
    },
    {
      id: "connections",
      label: "Connect Meta before publishing",
      description: "You can leave this until the ad is approved and ready to launch.",
      complete: hasConnection,
      href: "/settings#connections",
    },
  ];

  return (
    <main className="content">
      <PageHeading
        eyebrow="Home"
        title="Start with one ad"
        description="Blockwise can build your first ad before your ad accounts are connected."
        actions={
          <Link className="button" href="/ad-studio?first=1">
            Create first ad
            <ArrowRight aria-hidden size={16} />
          </Link>
        }
      />

      <section className="panel">
        <div className="stack">
          <StatusPill tone="blue">Trial</StatusPill>
          <h2>10 free ad packs are included</h2>
          <p className="item-meta">
            Generating your first ad uses 1 pack. Meta is only needed when you are ready to publish.
          </p>
          <div className="wizard-actions">
            <Link className="button" href="/ad-studio?first=1">
              Create first ad
              <ArrowRight aria-hidden size={16} />
            </Link>
            <Link className="button secondary" href="/onboarding">
              Set up workspace
            </Link>
          </div>
        </div>
      </section>

      <SetupChecklist items={checklist} />

      <section className="grid cols-3" aria-label="Next actions">
        <article className="item-card">
          <PenLine aria-hidden color="#123e75" size={20} />
          <h3>Create</h3>
          <p className="item-meta">Turn one listing photo and a short brief into Meta-ready ad formats.</p>
        </article>
        <article className="item-card">
          <Palette aria-hidden color="#123e75" size={20} />
          <h3>Brand</h3>
          <p className="item-meta">Keep colours, tone, and compliance defaults tidy before review.</p>
        </article>
        <article className="item-card">
          <Plug aria-hidden color="#123e75" size={20} />
          <h3>Publish later</h3>
          <p className="item-meta">Connect Meta only when the ad is approved and ready to go live.</p>
        </article>
      </section>
    </main>
  );
}
