import { ArrowRight, Check, ChevronRight, Clock3, FileSearch, Radar } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

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
  const region = access.region ?? "AU";
  const hasBrand = Boolean(brandKit?.business_name?.trim());
  const hasProvider = (connections.count ?? 0) > 0;
  const usedAdPacks = Math.max(0, campaigns.count ?? 0);
  const remainingAdPacks = Math.max(0, INCLUDED_AD_PACKS - usedAdPacks);
  const setupComplete = hasBrand && hasProvider && usedAdPacks > 0;

  // One screen, one next action. The heading, the header button, and the
  // highlighted setup row all point at the first incomplete step.
  const { heading, subtitle, ctaLabel, ctaHref } = !hasBrand
    ? {
        heading: "Set up your brand.",
        subtitle: "Add your logo and colours once — Blockwise turns them into ad-ready creatives.",
        ctaLabel: "Set up brand",
        ctaHref: "/ad-studio/brand",
      }
    : !hasProvider
      ? {
          heading: "Connect Meta.",
          subtitle: "Link your ad account so finished ads publish straight to your own campaigns.",
          ctaLabel: "Connect Meta",
          ctaHref: "/settings#connections",
        }
      : usedAdPacks === 0
        ? {
            heading: "Create your first ad.",
            subtitle: "Your brand is ready. Turn a listing into Feed and Story creatives in minutes.",
            ctaLabel: "Create ad",
            ctaHref: "/ad-studio?newAd=1",
          }
        : {
            heading: "Welcome back.",
            subtitle: `Here's where ${displayName} stands today.`,
            ctaLabel: "Create ad",
            ctaHref: "/ad-studio?newAd=1",
          };

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
    {
      id: "brand",
      n: 1,
      title: "Brand pack",
      description: "Logo, colours and key details",
      href: "/ad-studio/brand",
      complete: hasBrand,
      doneLabel: "Complete",
    },
    {
      id: "connect",
      n: 2,
      title: "Connect Meta",
      description: "Link your ad account",
      href: "/settings#connections",
      complete: hasProvider,
      doneLabel: "Connected",
    },
    {
      id: "publish",
      n: 3,
      title: "First ad",
      description: "Publish to Feed and Story",
      href: "/ad-studio?newAd=1",
      complete: usedAdPacks > 0,
      doneLabel: "Published",
    },
  ];
  const completedCount = steps.filter((step) => step.complete).length;
  const currentStepId = steps.find((step) => !step.complete)?.id ?? null;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  return (
    <>
      <ConfirmRegistrationTracker />
      <main
        className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 md:px-8 md:pt-10"
        aria-label="Self-serve overview"
      >
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1
              id="self-serve-title"
              className="text-2xl font-bold tracking-tight text-balance md:text-3xl"
            >
              {heading}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <Button asChild size="lg">
            <Link href={ctaHref}>
              {ctaLabel}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        {/* Workspace status strip */}
        <Card className="mt-8 overflow-hidden py-0">
          <CardContent className="p-0">
            <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
              <div className="bg-card px-5 py-4">
                <dt className="text-xs font-medium text-muted-foreground">Ads created</dt>
                <dd className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">
                  {usedAdPacks}
                </dd>
              </div>
              <div className="bg-card px-5 py-4">
                <dt className="text-xs font-medium text-muted-foreground">Free ad packs left</dt>
                <dd className="mt-1.5 flex items-baseline gap-1 text-2xl font-bold tracking-tight tabular-nums">
                  {remainingAdPacks}
                  <span className="text-sm font-medium text-muted-foreground">
                    / {INCLUDED_AD_PACKS}
                  </span>
                </dd>
                <Progress
                  value={(usedAdPacks / INCLUDED_AD_PACKS) * 100}
                  className="mt-2.5 h-1.5"
                  aria-label="Ad packs used"
                />
              </div>
              <div className="bg-card px-5 py-4">
                <dt className="text-xs font-medium text-muted-foreground">Meta connection</dt>
                <dd className="mt-2 flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      hasProvider ? "bg-(--green-bright)" : "bg-(--faint)",
                    )}
                  />
                  {hasProvider ? "Connected" : "Not connected"}
                </dd>
              </div>
              <div className="bg-card px-5 py-4">
                <dt className="text-xs font-medium text-muted-foreground">Brand pack</dt>
                <dd className="mt-2 flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      hasBrand ? "bg-(--green-bright)" : "bg-(--faint)",
                    )}
                  />
                  {hasBrand ? "Ready" : "Incomplete"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Setup + brand */}
        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>{setupComplete ? "Ready to publish" : "Setup progress"}</CardTitle>
              <CardDescription>
                {setupComplete
                  ? "Everything is connected. Turn your next listing into a live ad."
                  : "Three steps stand between you and your first live ad."}
              </CardDescription>
              {!setupComplete ? (
                <CardAction>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {completedCount} of {steps.length}
                  </span>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {setupComplete ? (
                <div className="grid gap-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Your brand pack is ready and Meta is connected. Pick a proven sample, add your
                    listing photos, and Blockwise generates on-brand Feed and Story creatives.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild>
                      <Link href="/ad-studio?newAd=1">
                        Create ad
                        <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/ad-studio/library">Ad library</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <ol className="grid gap-1">
                  {steps.map((step) => {
                    const isCurrent = step.id === currentStepId;
                    return (
                      <li key={step.id}>
                        <Link
                          href={step.href}
                          aria-current={isCurrent ? "step" : undefined}
                          className={cn(
                            "flex min-h-14 items-center gap-3.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted",
                            isCurrent && "bg-(--accent-tint) hover:bg-(--accent-tint)",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "grid size-8 shrink-0 place-items-center rounded-full border text-sm font-bold",
                              step.complete
                                ? "border-transparent bg-(--accent-tint) text-(--accent)"
                                : isCurrent
                                  ? "border-(--accent) bg-background text-(--accent)"
                                  : "border-border bg-muted/50 text-muted-foreground",
                            )}
                          >
                            {step.complete ? <Check className="size-4" /> : step.n}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {step.title}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {step.description}
                            </span>
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "hidden sm:inline-flex",
                              step.complete
                                ? "bg-(--green-soft) text-(--green)"
                                : isCurrent
                                  ? "bg-(--accent-tint) text-(--accent)"
                                  : "text-muted-foreground",
                            )}
                          >
                            {step.complete ? step.doneLabel : isCurrent ? "Up next" : "Waiting"}
                          </Badge>
                          <ChevronRight
                            aria-hidden
                            className="size-4 shrink-0 text-(--faint)"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
            <CardFooter className="border-t pt-6">
              {setupComplete ? (
                <Link
                  href="/results"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-(--accent) transition-colors hover:text-(--accent-strong)"
                >
                  View ad performance
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              ) : (
                <div className="flex w-full items-center gap-3">
                  <Progress
                    value={progressPct}
                    className="h-1.5 flex-1"
                    aria-label="Setup progress"
                  />
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {progressPct}% complete
                  </span>
                </div>
              )}
            </CardFooter>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Brand pack</CardTitle>
              <CardAction>
                <Badge
                  variant="secondary"
                  className={cn(
                    hasBrand ? "bg-(--green-soft) text-(--green)" : "text-muted-foreground",
                  )}
                >
                  {hasBrand ? "Ready" : "Incomplete"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback className="bg-(--accent-tint) text-sm font-bold text-(--accent)">
                    {initialsFor(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Real estate agent · {region}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Brand colours</p>
                <div className="mt-2 flex gap-1.5" aria-label="Brand colours">
                  {brandColors.map((color) => (
                    <span
                      key={color}
                      title={color}
                      className="size-6 rounded-full border border-border"
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
            <CardFooter className="mt-auto border-t pt-6">
              <div className="flex w-full items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 aria-hidden className="size-3.5" />
                  About 4 minutes
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href="/ad-studio/brand">
                    {hasBrand ? "Edit brand pack" : "Set up brand"}
                  </Link>
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Quick actions */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Link href="/ad-radar" className="group rounded-xl outline-none">
            <Card className="transition-colors group-hover:border-(--line-heavy) group-focus-visible:border-(--line-heavy)">
              <CardContent className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-lg bg-(--surface-subtle) text-(--accent)"
                >
                  <Radar className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Ad Radar</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    See top-performing ads from agents near you.
                  </span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-(--faint) transition-transform group-hover:translate-x-0.5"
                />
              </CardContent>
            </Card>
          </Link>
          <Link href="/property-check" className="group rounded-xl outline-none">
            <Card className="transition-colors group-hover:border-(--line-heavy) group-focus-visible:border-(--line-heavy)">
              <CardContent className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-lg bg-(--surface-subtle) text-(--accent)"
                >
                  <FileSearch className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Property Check</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Instant insights and ad ideas for any listing.
                  </span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-(--faint) transition-transform group-hover:translate-x-0.5"
                />
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </>
  );
}
