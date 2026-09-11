"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { SafeImage } from "@/components/ui/safe-image";
import { niche } from "@/config/niche";
import type { HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import { formatCurrency } from "@/lib/meta-monitor/calculations";
import { entrance, useReducedMotion } from "@/lib/motion";
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
    daily: Array<{ date: string; leads: number; spend: number; clicks: number }>;
    /** Trailing seven days, the window the metrics band claims. */
    weekly: { spend: number; clicks: number; cpc: number | null };
    /** True when every number above is a labelled preview, not this workspace's delivery. */
    isSample: boolean;
    lastSyncedAt: string | null;
  } | null;
  creativeSuggestions?: HomeCreativeSuggestions;
  leads: Array<{
    id: string;
    name: string;
    suburb: string;
    source: string;
    createdAt: string;
  }>;
  perthAds: Array<{
    id: string;
    pageName: string;
    headline: string | null;
    suburb: string | null;
    state: string | null;
    imageUrl: string | null;
  }>;
};

type Stat = {
  label: string;
  value: string;
  foot?: string;
};

/** Costs read as money, so cents stay visible: $0.80, never $0.8. */
const cents = (value: number) =>
  `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The metrics band is a weekly view, so every figure comes from the trailing
 * seven days. Sample previews only fill the band when the workspace has no
 * performance data of its own, and are labelled as samples everywhere they
 * appear.
 */
function statsFor(data: HomeData): Stat[] {
  const copy = niche.copy.home.kpis;
  const perf = data.performance;
  if (!perf) return [];

  const { weekly } = perf;
  const out: Stat[] = [
    { label: copy.weeklySpend, value: formatCurrency(weekly.spend) },
    { label: copy.weeklyClicks, value: weekly.clicks.toLocaleString("en-AU") },
    {
      label: copy.weeklyCpc,
      value: weekly.cpc != null ? cents(weekly.cpc) : "—",
    },
  ];

  if (perf.isSample) {
    out.push({ label: copy.leads, value: String(perf.leads), foot: copy.leadsPreviewFoot });
  } else {
    out.push({
      label: copy.adsLive,
      value: String(data.ads.live ?? data.ads.created),
      foot: copy.adsLiveUnit(data.ads.created),
    });
  }

  return out;
}

function StatBand({ data, stats }: { data: HomeData; stats: Stat[] }) {
  if (stats.length === 0) return null;
  const copy = niche.copy.home.kpis;
  const perf = data.performance;
  const synced = perf?.lastSyncedAt
    ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(perf.lastSyncedAt),
      )
    : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-foreground">
          {copy.weeklyTitle}
        </h1>
        {perf?.isSample ? (
          <span className="rounded-full border border-(--line-heavy) px-2.5 py-1 font-mono text-[9.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {copy.sampleBadge}
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-[12.5px] font-semibold text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                {stat.value}
              </span>
            </dd>
            {stat.foot ? <p className="mt-1 text-[11.5px] text-(--faint)">{stat.foot}</p> : null}
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11.5px] text-(--faint)">
        {perf?.isSample ? copy.sampleNote : synced ? `${copy.weekScope} · ${copy.syncedAt(synced)}` : copy.weekScope}
      </p>
    </>
  );
}

function relativeTime(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso.slice(0, 10);
  const diff = Date.now() - parsed;
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * How long a lead has been sitting untouched. The workspace has no CRM contact
 * state yet, so waiting time is the only follow-up signal that can be stated
 * without inventing one.
 */
function waitingLabel(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const days = Math.floor((Date.now() - parsed) / 86_400_000);
  if (days < 1) return "Waiting since today";
  if (days === 1) return "Waiting 1 day";
  return `Waiting ${days} days`;
}

function LeadsSection({ leads }: { leads: HomeData["leads"] }) {
  const copy = niche.copy.home.leads;
  if (leads.length === 0) {
    return (
      <section className="mt-9 md:mt-11">
        <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em] text-foreground">
          {copy.title}
        </h2>
        <div className="mt-4 grid place-items-center rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-12 text-center">
          <p className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-foreground">
            {copy.emptyTitle}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{copy.emptyBody}</p>
          <ButtonArrow href="/ad-studio" className="mt-5">
            {copy.ctaLabel}
          </ButtonArrow>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-9 md:mt-11">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em] text-foreground">
            {copy.title}
          </h2>
          <span className="text-[12.5px] text-(--faint)">{copy.followUp}</span>
        </div>
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {copy.viewAll}
          <ArrowRight size={14} />
        </Link>
      </div>
      <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line)">
        {leads.map((lead) => (
          <li key={lead.id}>
            <Link
              href="/leads"
              className="group flex min-h-[60px] items-center gap-3 py-2 transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] font-semibold text-foreground">{lead.name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {lead.suburb} · {lead.source}
                </span>
              </div>
              <span className="hidden shrink-0 text-[11.5px] font-semibold text-warning tabular-nums sm:block">
                {waitingLabel(lead.createdAt)}
              </span>
              <span className="shrink-0 text-[11.5px] text-(--faint) tabular-nums">
                {relativeTime(lead.createdAt)}
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
    </section>
  );
}

function PerthAdsSection({ ads }: { ads: HomeData["perthAds"] }) {
  const copy = niche.copy.home.perthAds;
  if (ads.length === 0) return null;

  return (
    <section className="mt-9 md:mt-11">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em] text-foreground">
          {copy.title}
        </h2>
        <Link
          href="/ad-radar"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {copy.viewAll}
          <ArrowRight size={14} />
        </Link>
      </div>
      <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line)">
        {ads.map((ad) => (
          <li key={ad.id}>
            <Link
              href={`/ad-radar/ads/${encodeURIComponent(ad.id)}`}
              className="group flex min-h-[60px] items-center gap-3 py-2 transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-(--r-ctl) bg-(--surface-subtle)">
                {ad.imageUrl ? (
                  <SafeImage
                    src={ad.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    compactFallback
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-(--faint)">
                    Ad
                  </div>
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-foreground">
                  {ad.pageName}
                </span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {ad.headline ?? "Ad"} · {ad.suburb ? `${ad.suburb}, ${ad.state ?? "WA"}` : "Perth, WA"}
                </span>
              </div>
              <ArrowRight
                size={16}
                aria-hidden
                className="shrink-0 text-(--faint) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const reduced = useReducedMotion();
  const { container, item: itemVariants } = entrance(reduced);
  const stats = statsFor(data);

  return (
    <motion.div
      data-home-creative
      variants={container}
      initial="hidden"
      animate="visible"
      className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-6 md:px-6 md:pb-16 md:pt-8"
    >
      <motion.section variants={itemVariants}>
        <StatBand data={data} stats={stats} />
      </motion.section>

      <motion.section variants={itemVariants}>
        <LeadsSection leads={data.leads} />
      </motion.section>

      <motion.section variants={itemVariants}>
        <PerthAdsSection ads={data.perthAds} />
      </motion.section>
    </motion.div>
  );
}
