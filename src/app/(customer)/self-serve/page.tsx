import { ArrowRight, Check, ChevronRight, CircleAlert, Clock3, FileSearch, Megaphone, Package, Palette, Plug, Radar } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
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
              className="font-display text-[26px] leading-tight font-extrabold tracking-[-0.02em] text-balance md:text-[28px]"
            >
              {heading}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <ButtonArrow href={ctaHref}>{ctaLabel}</ButtonArrow>
        </div>

        {/* Key numbers */}
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="rounded-[14px] border-0 py-0 shadow-(--shadow) transition-all duration-200 hover:-translate-y-1 hover:shadow-(--shadow-float)">
            <CardContent className="p-[18px]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-medium tracking-[0.1em] text-(--faint) uppercase">
                  Ads created
                </p>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--accent-tint) text-(--accent)">
                  <Megaphone aria-hidden className="size-4" />
                </span>
              </div>
              <p className="mt-3 font-display text-2xl font-extrabold tracking-[-0.02em] tabular-nums">
                {usedAdPacks}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {usedAdPacks === 0
                  ? "No ads yet"
                  : usedAdPacks === 1
                    ? "1 ad published"
                    : `${usedAdPacks} ads published`}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[14px] border-0 py-0 shadow-(--shadow) transition-all duration-200 hover:-translate-y-1 hover:shadow-(--shadow-float)">
            <CardContent className="p-[18px]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-medium tracking-[0.1em] text-(--faint) uppercase">
                  Ad packs left
                </p>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--accent-tint) text-(--accent)">
                  <Package aria-hidden className="size-4" />
                </span>
              </div>
              <p className="mt-3 flex items-baseline gap-1 font-display text-2xl font-extrabold tracking-[-0.02em] tabular-nums">
                {remainingAdPacks}
                <span className="font-sans text-sm font-medium text-muted-foreground">
                  / {INCLUDED_AD_PACKS}
                </span>
              </p>
              <Progress
                value={(usedAdPacks / INCLUDED_AD_PACKS) * 100}
                className="mt-2.5 h-1.5"
                aria-label="Ad packs used"
              />
            </CardContent>
          </Card>

          <Card className="rounded-[14px] border-0 py-0 shadow-(--shadow) transition-all duration-200 hover:-translate-y-1 hover:shadow-(--shadow-float)">
            <CardContent className="p-[18px]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-medium tracking-[0.1em] text-(--faint) uppercase">
                  Meta connection
                </p>
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    hasProvider
                      ? "bg-(--green-soft) text-(--green)"
                      : "bg-(--amber)/10 text-(--amber)",
                  )}
                >
                  <Plug aria-hidden className="size-4" />
                </span>
              </div>
              <p
                className={cn(
                  "mt-3 flex items-center gap-1.5 text-lg font-bold",
                  hasProvider ? "text-(--green)" : "text-(--amber)",
                )}
              >
                {hasProvider ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <CircleAlert aria-hidden className="size-4" />
                )}
                {hasProvider ? "Connected" : "Not connected"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasProvider ? "Ad account linked" : "Link your ad account"}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[14px] border-0 py-0 shadow-(--shadow) transition-all duration-200 hover:-translate-y-1 hover:shadow-(--shadow-float)">
            <CardContent className="p-[18px]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-medium tracking-[0.1em] text-(--faint) uppercase">
                  Brand pack
                </p>
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    hasBrand
                      ? "bg-(--green-soft) text-(--green)"
                      : "bg-(--amber)/10 text-(--amber)",
                  )}
                >
                  <Palette aria-hidden className="size-4" />
                </span>
              </div>
              <p
                className={cn(
                  "mt-3 flex items-center gap-1.5 text-lg font-bold",
                  hasBrand ? "text-(--green)" : "text-(--amber)",
                )}
              >
                {hasBrand ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <CircleAlert aria-hidden className="size-4" />
                )}
                {hasBrand ? "Ready" : "Incomplete"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasBrand ? "Logo and colours set" : "Add your brand details"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Setup + brand */}
        <div className="mt-10 grid gap-5 lg:grid-cols-5">
          <Card className="border-0 rounded-(--r-panel) shadow-(--shadow) transition-shadow duration-200 hover:shadow-(--shadow-float) lg:col-span-3">
            <CardHeader>
              <CardTitle className="font-display font-extrabold tracking-[-0.02em]">
                {setupComplete ? "Ready to publish" : "Setup progress"}
              </CardTitle>
              <CardDescription>
                {setupComplete
                  ? "Everything is connected. Turn your next listing into a live ad."
                  : "Three steps stand between you and your first live ad."}
              </CardDescription>
              {!setupComplete ? (
                <CardAction>
                  <span className="rounded-full bg-(--surface-subtle) px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase tabular-nums">
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
                            "flex min-h-14 items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted",
                            isCurrent && "bg-(--accent-tint) hover:bg-(--accent-tint)",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "grid size-8 shrink-0 place-items-center rounded-full font-display text-sm font-extrabold",
                              step.complete
                                ? "bg-(--green-soft) text-(--green)"
                                : isCurrent
                                  ? "bg-(--ink) text-white"
                                  : "border border-border bg-(--surface-subtle) text-muted-foreground",
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
                              "hidden rounded-full sm:inline-flex",
                              step.complete
                                ? "bg-(--green-soft) text-(--green)"
                                : isCurrent
                                  ? "bg-white/80 text-(--ink)"
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
            <CardFooter className="pt-6">
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
                  <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase tabular-nums">
                    {progressPct}% complete
                  </span>
                </div>
              )}
            </CardFooter>
          </Card>

          <Card className="border-0 rounded-(--r-panel) shadow-(--shadow) transition-shadow duration-200 hover:shadow-(--shadow-float) lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display font-extrabold tracking-[-0.02em]">Brand pack</CardTitle>
              <CardAction>
                <Badge
                  variant="secondary"
                  className={cn(
                    "rounded-full",
                    hasBrand ? "bg-(--green-soft) text-(--green)" : "bg-(--amber)/10 text-(--amber)",
                  )}
                >
                  {hasBrand ? "Ready" : "Incomplete"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback className="bg-(--accent-tint) font-display text-sm font-extrabold text-(--accent)">
                    {initialsFor(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{displayName}</p>
                  <p className="truncate font-mono text-[10px] tracking-[0.08em] text-(--faint) uppercase">
                    Real estate · {region}
                  </p>
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] font-medium tracking-[0.1em] text-(--faint) uppercase">
                  Brand colours
                </p>
                <div className="mt-2 flex gap-1.5" aria-label="Brand colours">
                  {brandColors.map((color) => (
                    <span
                      key={color}
                      title={color}
                      className="size-6 rounded-full border border-border shadow-(--shadow)"
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
            <CardFooter className="mt-auto pt-6">
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
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Link href="/ad-radar" className="group rounded-(--r-panel) outline-none">
            <Card className="border-0 rounded-(--r-panel) shadow-(--shadow) transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-(--shadow-float) group-focus-visible:shadow-(--shadow-float)">
              <CardContent className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-(--accent-tint) text-(--accent)"
                >
                  <Radar className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">Ad Radar</span>
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
          <Link href="/property-check" className="group rounded-(--r-panel) outline-none">
            <Card className="border-0 rounded-(--r-panel) shadow-(--shadow) transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-(--shadow-float) group-focus-visible:shadow-(--shadow-float)">
              <CardContent className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-(--accent-tint) text-(--accent)"
                >
                  <FileSearch className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">Property Check</span>
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
