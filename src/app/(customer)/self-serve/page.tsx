import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

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
  const hasBrand = Boolean(brandKit?.business_name?.trim());
  const hasProvider = (connections.count ?? 0) > 0;
  const usedAdPacks = Math.max(0, campaigns.count ?? 0);

  // One screen, one next action. The heading and the single button both point
  // at the first incomplete step of the setup path.
  const { heading, ctaLabel, ctaHref } = !hasBrand
    ? { heading: "Set up your brand.", ctaLabel: "Set up brand", ctaHref: "/ad-studio/brand" }
    : !hasProvider
      ? { heading: "Connect Meta.", ctaLabel: "Connect Meta", ctaHref: "/settings#connections" }
      : usedAdPacks === 0
        ? { heading: "Create your first ad.", ctaLabel: "Create ad", ctaHref: "/ad-studio?newAd=1" }
        : { heading: "Welcome back.", ctaLabel: "Create ad", ctaHref: "/ad-studio?newAd=1" };

  const colours =
    brandKit?.colours_json && typeof brandKit.colours_json === "object"
      ? (brandKit.colours_json as Record<string, unknown>)
      : {};
  const brandColors = [
    typeof colours.primary === "string" ? colours.primary : "#07152b",
    typeof colours.secondary === "string" ? colours.secondary : "#315ca8",
    typeof colours.accent === "string" ? colours.accent : "#e8e8e8",
  ];

  const steps = [
    { label: "Brand", href: "/ad-studio/brand", complete: hasBrand },
    { label: "Meta", href: "/settings#connections", complete: hasProvider },
    { label: "First ad", href: "/ad-studio?newAd=1", complete: usedAdPacks > 0 },
  ];

  return (
    <>
      <ConfirmRegistrationTracker />
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12 md:px-0" aria-label="Self-serve overview">
        <Card>
          <CardContent className="flex flex-col gap-6">
            <h1 id="self-serve-title" className="text-2xl font-bold tracking-tight text-balance">
              {heading}
            </h1>

            <div className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback className="bg-(--accent-tint) text-(--accent) font-semibold">
                  {initialsFor(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <div className="mt-1.5 flex gap-1.5" aria-label="Brand colours">
                  {brandColors.map((color) => (
                    <span
                      key={color}
                      className="size-4 rounded-full border border-border"
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Button asChild size="lg">
                <Link href={ctaHref}>
                  {ctaLabel}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <ol className="flex items-center gap-2" aria-label="Setup progress">
          {steps.map((step, index) => (
            <li key={step.label} className="flex-1">
              <Link
                href={step.href}
                className="flex items-center gap-2 rounded-(--r-card) px-2 py-1.5 transition-colors hover:bg-(--surface-subtle)"
              >
                <Badge
                  variant={step.complete ? "default" : "secondary"}
                  className="size-6 shrink-0 p-0"
                  aria-label={step.complete ? `${step.label} complete` : `Step ${index + 1}`}
                >
                  {step.complete ? <Check aria-hidden className="size-3.5" /> : index + 1}
                </Badge>
                <span className="text-sm font-medium">{step.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
