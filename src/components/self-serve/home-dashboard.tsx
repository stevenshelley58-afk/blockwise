"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Shuffle } from "lucide-react";
import Link from "next/link";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/ui/safe-image";
import { niche } from "@/config/niche";
import type { HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import { formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import { entrance, useReducedMotion } from "@/lib/motion";
import type { HomeDailyPoint } from "./home-chart";
import type { ActivationCardData } from "./activation-card";

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

type Stat = {
  label: string;
  value: string;
  foot?: string;
  /** Fractional change vs the previous period. Null renders no trend. */
  trend?: number | null;
};

/**
 * Home shows workspace facts and, when a real reporting snapshot exists, its
 * results. It never renders a metric it cannot stand behind: without a
 * snapshot the row reports ads created rather than a fabricated "0 leads".
 */
function statsFor(data: HomeData): Stat[] {
  const copy = niche.copy.home.kpis;
  const perf = data.performance;
  const out: Stat[] = [];

  if (data.ads.live != null) {
    out.push({
      label: copy.adsLive,
      value: String(data.ads.live),
      foot: copy.adsLiveUnit(data.ads.created),
    });
  } else {
    out.push({
      label: copy.adsCreated,
      value: String(data.ads.created),
      foot:
        data.ads.created === 0
          ? copy.noAdsYet
          : data.ads.publishedThisWeek > 0
            ? copy.publishedThisWeek(data.ads.publishedThisWeek)
            : undefined,
    });
  }

  if (perf) {
    out.push({
      label: copy.leads,
      value: String(perf.leads),
      foot: perf.previousLeads != null ? `${perf.previousLeads} ${copy.vsPrior}` : undefined,
      trend:
        perf.previousLeads && perf.previousLeads > 0
          ? (perf.leads - perf.previousLeads) / perf.previousLeads
          : null,
    });
    if (perf.cpl != null) {
      out.push({ label: copy.costPerLead, value: formatCurrency(perf.cpl) });
    }
  }

  return out;
}

function TrendChip({ trend }: { trend: number }) {
  const isUp = trend >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${
        isUp ? "bg-success-soft text-success" : "bg-error-soft text-error"
      }`}
    >
      {isUp ? <ArrowUpRight size={11} aria-hidden /> : <ArrowDownRight size={11} aria-hidden />}
      {formatPercent(Math.abs(trend), 1)}
    </span>
  );
}

/** Empty state for the creative lead. Keeps the same hierarchy, offers one way out. */
function EmptyCreative({ status }: { status: HomeCreativeSuggestions["status"] | "missing" }) {
  const title =
    status === "unavailable"
      ? "Template suggestions are unavailable right now."
      : status === "exhausted"
        ? "You have used every template."
        : "Templates will appear here when available.";
  return (
    <div className="mt-7 grid place-items-center rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-12 text-center">
      <p className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-foreground">
        {title}
      </p>
      <ButtonArrow href="/ad-studio/templates" className="mt-5">
        Browse templates
      </ButtonArrow>
    </div>
  );
}

function StatRow({ stats, scope }: { stats: Stat[]; scope: string | null }) {
  if (stats.length === 0) return null;
  return (
    <>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-(--line) pt-5 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-[12.5px] font-semibold text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                {stat.value}
              </span>
              {stat.trend != null ? <TrendChip trend={stat.trend} /> : null}
            </dd>
            {stat.foot ? <p className="mt-1 text-[11.5px] text-(--faint)">{stat.foot}</p> : null}
          </div>
        ))}
      </dl>
      {scope ? <p className="mt-3 text-[11.5px] text-(--faint)">{scope}</p> : null}
    </>
  );
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const suggestions = data.creativeSuggestions;
  const items = itemsFor(suggestions);
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const { container, item: itemVariants } = entrance(reduced);

  useEffect(() => {
    setIndex((current) => (items.length ? Math.min(current, items.length - 1) : 0));
  }, [items.length]);

  const audience =
    suggestions?.audience && suggestions.audience in HEADLINES ? suggestions.audience : "fallback";
  const heading =
    suggestions?.status === "exhausted" ? "What will you create next?" : HEADLINES[audience];

  const lead = items[index];
  const rest = items.filter((_, position) => position !== index);
  const stats = statsFor(data);
  const scope = data.performance ? niche.copy.home.chart.subtitle : null;

  return (
    <motion.div
      data-home-creative
      variants={container}
      initial="hidden"
      animate="visible"
      className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-6 md:px-6 md:pb-16 md:pt-8"
    >
      <motion.header variants={itemVariants} className="max-w-[700px]">
        <h1 className="font-display text-[clamp(26px,4vw,34px)] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground">
          {heading}
        </h1>
      </motion.header>

      {lead ? (
        <motion.section variants={itemVariants} aria-label="Recommended template" className="mt-7">
          <div className="grid items-center gap-6 md:grid-cols-[minmax(220px,0.85fr)_minmax(280px,1fr)] md:gap-10">
            <div className="flex justify-center md:justify-start">
              <div className="h-[300px] w-[240px] overflow-hidden rounded-(--r-card) bg-(--surface-subtle) md:h-[340px] md:w-[272px]">
                <SafeImage
                  src={lead.previewUrl}
                  alt={`${lead.name} template preview`}
                  className="h-full w-full object-contain"
                />
              </div>
            </div>

            <div className="min-w-0">
              <h2 className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-foreground md:text-[24px]">
                {lead.name}
              </h2>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <ButtonArrow href={lead.href}>Use template</ButtonArrow>
                {items.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost-pill"
                    size="pill"
                    onClick={() => setIndex((current) => (current + 1) % items.length)}
                    className="min-h-11 px-4 text-[13.5px] transition-transform duration-150 active:scale-[0.97] motion-reduce:active:scale-100"
                  >
                    <Shuffle size={14} aria-hidden />
                    Next idea
                  </Button>
                ) : null}
              </div>

              <Link
                href="/ad-studio/templates"
                className="mt-4 inline-flex min-h-11 items-center text-[13.5px] font-semibold text-muted-foreground underline decoration-(--line-heavy) underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Browse all templates
              </Link>
            </div>
          </div>
        </motion.section>
      ) : (
        <motion.div variants={itemVariants}>
          <EmptyCreative status={suggestions?.status ?? "missing"} />
        </motion.div>
      )}

      {rest.length > 0 ? (
        <motion.section variants={itemVariants} className="mt-9 md:mt-11">
          <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em] text-foreground">
            More ideas
          </h2>
          <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line)">
            {rest.map((suggestion) => (
              <li key={suggestion.templateId}>
                <Link
                  href={suggestion.href}
                  className="group flex min-h-[60px] items-center gap-3 py-2 transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="h-[52px] w-[40px] shrink-0 overflow-hidden rounded-(--r-ctl) bg-(--surface-subtle)">
                    <SafeImage
                      src={suggestion.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      compactFallback
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
                    {suggestion.name}
                  </span>
                  <ArrowRight
                    size={16}
                    aria-hidden
                    className="shrink-0 text-(--faint) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}

      <motion.section variants={itemVariants} className="mt-9 md:mt-11">
        <StatRow stats={stats} scope={scope} />
      </motion.section>
    </motion.div>
  );
}
