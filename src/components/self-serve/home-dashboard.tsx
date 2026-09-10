"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";

import { MetaKpiCard } from "@/components/monitor/MetaKpiCard";
import { niche } from "@/config/niche";
import type { HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import { formatCurrency } from "@/lib/meta-monitor/calculations";
import { ActivationCard, type ActivationCardData } from "./activation-card";
import type { HomeDailyPoint } from "./home-chart";
import { HomePerformanceChart } from "./home-chart";

export type HomeData = ActivationCardData & {
  workspaceName: string;
  hasBrand: boolean;
  hasProvider: boolean;
  ads: { created: number; live: number | null; publishedThisWeek: number };
  performance: {
    leads: number;
    cpl: number | null;
    previousLeads: number | null;
    previousCpl: number | null;
    daily: HomeDailyPoint[];
    lastSyncedAt: string | null;
  } | null;
  creativeSuggestions?: HomeCreativeSuggestions;
};

const HEADLINES: Record<HomeCreativeSuggestions["audience"] | "fallback", string> = {
  first_ad: "Make your first ad",
  returning: "Try a different look",
  unknown: "Find your next idea",
  fallback: "Find your next idea",
};

function itemsFor(suggestions: HomeCreativeSuggestions | undefined) {
  return suggestions?.status === "ready" ? suggestions.items.slice(0, 3) : [];
}

/**
 * Progressive greeting. Falls back through brand → provider → first ad → ready so
 * the page says what matters right now rather than a greeting nobody can act on.
 */
function greetingFor(data: HomeData): { heading: string; subtitle: string } {
  const states = niche.copy.home.states;
  if (!data.hasBrand) {
    return { heading: states.needsBrand.heading, subtitle: states.needsBrand.subtitle };
  }
  if (!data.hasProvider) {
    return { heading: states.needsProvider.heading, subtitle: states.needsProvider.subtitle };
  }
  if (data.ads.created === 0) {
    return { heading: states.needsFirstAd.heading, subtitle: states.needsFirstAd.subtitle };
  }
  return { heading: states.ready.heading, subtitle: states.ready.subtitle(data.workspaceName) };
}

type Kpi = {
  label: string;
  value: string;
  compareText?: string;
  trend?: number | null;
  goodWhenDown?: boolean;
};

/**
 * Only surfaces numbers we can actually stand behind. A workspace with no
 * reporting snapshot gets ad counts, not a fabricated "0 leads".
 */
function kpisFor(data: HomeData): Kpi[] {
  const copy = niche.copy.home.kpis;
  const out: Kpi[] = [];
  const perf = data.performance;

  if (perf) {
    const trend =
      perf.previousLeads && perf.previousLeads > 0
        ? (perf.leads - perf.previousLeads) / perf.previousLeads
        : null;
    out.push({
      label: copy.leads,
      value: String(perf.leads),
      compareText:
        perf.previousLeads != null ? `${perf.previousLeads} ${copy.vsPrior}` : undefined,
      trend,
    });
    if (perf.cpl != null) {
      out.push({ label: copy.costPerLead, value: formatCurrency(perf.cpl), goodWhenDown: true });
    }
  }

  if (data.ads.live != null) {
    out.push({
      label: copy.adsLive,
      value: String(data.ads.live),
      compareText: copy.adsLiveUnit(data.ads.created),
    });
  } else {
    out.push({
      label: copy.adsCreated,
      value: String(data.ads.created),
      compareText:
        data.ads.created === 0
          ? copy.noAdsYet
          : data.ads.publishedThisWeek > 0
            ? copy.publishedThisWeek(data.ads.publishedThisWeek)
            : undefined,
    });
  }

  return out;
}

function EmptyCreative({ status }: { status: HomeCreativeSuggestions["status"] | "missing" }) {
  const detail = status === "unavailable"
    ? "Template suggestions are unavailable right now."
    : status === "exhausted" ? "Browse your templates for another idea." : "Templates will appear here when available.";
  return (
    <div>
      <p className="text-[15px] leading-6 text-muted-foreground">{detail}</p>
      <Link href="/ad-studio/templates" data-home-primary
        className="mt-4 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-(--r-ctl) border border-border px-4 text-[15px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Browse templates <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function ReadyCreative({
  item, hasNext, onNext,
}: {
  item: HomeCreativeSuggestions["items"][number];
  hasNext: boolean;
  onNext: () => void;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === item.templateId;
  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(260px,0.95fr)_minmax(260px,1fr)] md:items-center md:gap-10">
      <div className="flex min-w-0 justify-center md:justify-start">
        {failed ? (
          <div className="flex min-h-24 w-full max-w-[320px] flex-col justify-center py-4 md:max-w-[360px]">
            <p className="text-[15px] font-semibold text-foreground">Preview unavailable</p>
            <Link href="/ad-studio/templates" data-home-primary
              className="mt-3 inline-flex min-h-11 w-fit items-center gap-2 rounded-(--r-ctl) border border-border px-4 text-[15px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Browse templates <ArrowRight className="size-4" aria-hidden />
            </Link>

          </div>
        ) : (
          <div className="relative flex h-[300px] w-[240px] max-w-full items-center justify-center overflow-hidden rounded-(--r-card) bg-muted/40 md:h-[360px] md:w-[288px]">
            <img src={item.previewUrl} alt={item.name + " template preview"} data-template-preview
              className="h-full w-full object-contain" onError={() => setFailedId(item.templateId)} />
          </div>
        )}
      </div>
      <div className="min-w-0 md:py-2">
        <h3 className="max-w-[30rem] font-display text-[18px] font-extrabold leading-tight tracking-[-0.02em] text-foreground md:text-[24px]">{item.name}</h3>
        {failed ? (
          hasNext ? (
            <button type="button" onClick={onNext} aria-label="Next template"
              className="mt-4 inline-flex size-11 shrink-0 items-center justify-center rounded-(--r-ctl) border border-border text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className="size-5" aria-hidden />
            </button>
          ) : null
        ) : (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href={item.href} data-home-primary
                className="inline-flex min-h-12 w-fit items-center justify-center gap-2 rounded-(--r-ctl) bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Use template <ArrowRight className="size-4" aria-hidden />
              </Link>
              {hasNext ? (
                <button type="button" onClick={onNext} aria-label="Next template"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--r-ctl) border border-border text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronRight className="size-5" aria-hidden />
                </button>
              ) : null}
            </div>
            <Link href="/ad-studio/templates"
              className="mt-4 inline-flex min-h-11 w-fit items-center text-[15px] font-semibold text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Browse templates
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function QuickActions() {
  const actions = niche.copy.home.quickActions;
  if (actions.length === 0) return null;
  return (
    <section aria-label="Quick actions" className="mt-5 md:mt-6">
      <ul className="grid list-none gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <li key={action.href}>
            <Link href={action.href}
              className="flex min-h-16 items-center justify-between gap-3 rounded-(--r-card) border border-(--line) bg-(--surface) px-4 py-3 shadow-card transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-bold">{action.title}</span>
                <span className="block text-[12px] leading-snug text-muted-foreground">{action.subtitle}</span>
              </span>
              <ArrowRight aria-hidden size={16} className="shrink-0 text-(--faint)" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const suggestions = data.creativeSuggestions;
  const items = itemsFor(suggestions);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex((current) => items.length ? Math.min(current, items.length - 1) : 0);
  }, [items.length]);

  const audience = suggestions?.audience && suggestions.audience in HEADLINES ? suggestions.audience : "fallback";
  const headline = suggestions?.status === "exhausted"
    ? "What will you create next?"
    : suggestions?.status === "ready" ? HEADLINES[audience] : HEADLINES.fallback;
  const item = items[index];

  const greeting = greetingFor(data);
  const kpis = kpisFor(data);

  // The activation card is resolver-driven, so it stays accurate as milestones
  // change. It is hidden once setup is complete so returning users land on work
  // rather than onboarding they have already finished.
  const showSetup = data.activation.currentStage !== "complete";

  // Only render the chart when there is a real series. Rendering it with null
  // data would show "Reporting unavailable", which reads like a fault rather
  // than "you haven't published yet".
  const showChart = Boolean(data.performance?.daily && data.performance.daily.length > 0);

  return (
    <div data-home-creative
      className="mx-auto w-full max-w-[1120px] px-4 pb-6 pt-5 md:px-6 md:pb-12 md:pt-7">

      <header className="max-w-[34rem]">
        <h1 className="font-display text-[24px] font-extrabold leading-[1.05] tracking-[-0.025em] text-foreground md:text-[30px]">
          {greeting.heading}
        </h1>
        <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
          {greeting.subtitle}
        </p>
      </header>

      {kpis.length > 0 ? (
        <section aria-label="Performance summary" className="mt-4 md:mt-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpis.map((kpi) => (
              <MetaKpiCard
                key={kpi.label}
                compact
                label={kpi.label}
                value={kpi.value}
                compareText={kpi.compareText}
                trend={kpi.trend ?? null}
                goodWhenDown={kpi.goodWhenDown}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="home-creative-heading" className="mt-8 md:mt-10">
        <h2 id="home-creative-heading"
          className="max-w-[34rem] font-display text-[24px] font-extrabold leading-[1.05] tracking-[-0.025em] text-foreground md:text-[30px]">
          {headline}
        </h2>
        <div className="mt-5 md:mt-6">
          {item ? <ReadyCreative item={item} hasNext={items.length > 1}
            onNext={() => setIndex((current) => (current + 1) % items.length)} />
            : <EmptyCreative status={suggestions?.status ?? "missing"} />}
        </div>
      </section>

      {showSetup ? (
        <div className="mt-8 md:mt-10">
          <ActivationCard data={data} />
        </div>
      ) : null}

      {showChart ? (
        <div className="mt-4 md:mt-5">
          <HomePerformanceChart daily={data.performance!.daily} />
        </div>
      ) : null}

      <QuickActions />
    </div>
  );
}
