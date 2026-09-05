"use client";

/*
 * Home dashboard (Premium v2 mockup): outcome-first KPI row, performance
 * snapshot chart, setup card and quick actions. The server page hands down a
 * plain `HomeData` payload — this component owns layout, motion and copy
 * (all of it from the niche config; customer pages carry zero niche nouns).
 *
 * Data honesty: KPIs render live Meta numbers or honest zeros. Demo/sample
 * data never reaches Home.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  Megaphone,
  Sparkles,
  UsersRound,
} from "lucide-react";

import { navByVariant } from "@/components/sidebar-nav";
import { AnimatedGroup } from "@/components/ui/animated-group";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { niche } from "@/config/niche";
import { countUpDuration, cssSpring, springs } from "@/lib/motion";

import { HomePerformanceChart, type HomeDailyPoint } from "./home-chart";
import { ActivationCard, type ActivationCardData } from "./activation-card";
import { Sparkline } from "./sparkline";

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
  } | null;
};

const COUNT_SPRING = { ...springs.slow, duration: countUpDuration };

const money = (value: number) => `$${value.toFixed(2)}`;

/** Period-over-period delta badge (mockup pattern). Hidden without a prior period. */
function DeltaBadge({
  current,
  previous,
  downIsGood = false,
}: {
  current: number | null;
  previous: number | null;
  downIsGood?: boolean;
}) {
  // No current reading is not a 100% drop — without both periods there is no
  // honest delta to show.
  if (current == null || previous == null || previous === 0) return null;
  const change = (current - previous) / previous;
  if (!Number.isFinite(change) || Math.abs(change) < 0.005) return null;

  const up = change > 0;
  const good = downIsGood ? !up : up;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-[3px] text-xs font-bold ${good ? "text-success" : "text-error"}`}
    >
      <Arrow aria-hidden size={11} strokeWidth={2.4} />
      {Math.round(Math.abs(change) * 100)}%
    </span>
  );
}

/** Credit meter: data-hue fill on the data track, width eased on mount. */
function CreditMeter({ remaining, granted }: { remaining: number; granted: number }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const pct = granted > 0 ? Math.max(0, Math.min(100, (remaining / granted) * 100)) : 0;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={granted}
      aria-valuenow={remaining}
      aria-label={`${remaining} of ${granted} render credits remaining`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-data-track"
    >
      <div
        className="h-full rounded-full bg-data motion-reduce:transition-none"
        style={{
          transform: `scaleX(${on ? pct / 100 : 0})`,
          transformOrigin: "left",
          transition: `transform 1s ${cssSpring}`,
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  icon,
  children,
  foot,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  foot: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-(--r-card) bg-card px-[18px] pt-[17px] pb-[15px] shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          {label}
        </span>
        <span
          aria-hidden
          className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-(--accent-tint) text-foreground"
        >
          {icon}
        </span>
      </div>
      <p className="mt-2.5 flex items-baseline gap-[7px] font-display text-[24px] leading-[1.1] font-extrabold tracking-[-0.02em]">
        {children}
      </p>
      <div className="mt-[7px] flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        {foot}
      </div>
    </div>
  );
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const copy = niche.copy.home;
  const { credits, ads, performance } = data;

  const quickActions = copy.quickActions.filter(
    (action) => !action.feature || niche.features[action.feature],
  );

  const sparkPoints = (performance?.daily ?? []).map((point) => point.leads);
  const adsLiveValue = ads.live ?? ads.created;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      {/* Explicit minmax(0,1fr) tracks: without them a single nowrap leaf
          (e.g. a truncated subtitle) inflates the auto track and the whole
          column overflows <main> on small screens. */}
      <AnimatedGroup className="grid grid-cols-1 gap-3.5">
        {/* Page head */}
        <div>
          <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
            Customer workspace
          </p>
          <div>
            <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
              Home
            </h1>
            <p className="mt-1 text-[13.5px] text-muted-foreground">{data.workspaceName}</p>
          </div>
        </div>

        {/* KPI row */}
        <AnimatedGroup className="grid grid-cols-2 gap-3.5 xl:grid-cols-4" itemClassName="h-full">
          <StatCard
            label={copy.kpis.leads}
            icon={<UsersRound size={15} strokeWidth={1.8} />}
            foot={
              <>
                <span>{copy.kpis.vsPrior}</span>
                <Sparkline points={sparkPoints} />
              </>
            }
          >
            <AnimatedNumber value={performance?.leads ?? 0} springOptions={COUNT_SPRING} />
            <DeltaBadge current={performance?.leads ?? 0} previous={performance?.previousLeads ?? null} />
          </StatCard>

          <StatCard
            label={copy.kpis.costPerLead}
            icon={<CircleDollarSign size={15} strokeWidth={1.8} />}
            foot={<span>{copy.kpis.vsPrior}</span>}
          >
            {performance?.cpl != null ? (
              <AnimatedNumber value={performance.cpl} format={money} springOptions={COUNT_SPRING} />
            ) : (
              <span aria-label="No cost data yet">—</span>
            )}
            <DeltaBadge current={performance?.cpl ?? null} previous={performance?.previousCpl ?? null} downIsGood />
          </StatCard>

          <StatCard
            label={ads.live != null ? copy.kpis.adsLive : copy.kpis.adsCreated}
            icon={<Megaphone size={15} strokeWidth={1.8} />}
            foot={
              <span>{ads.created > 0 ? copy.kpis.publishedThisWeek(ads.publishedThisWeek) : copy.kpis.noAdsYet}</span>
            }
          >
            <AnimatedNumber value={adsLiveValue} springOptions={COUNT_SPRING} />
            {ads.live != null && (
              <span className="font-sans text-[13px] font-medium tracking-normal text-muted-foreground">
                {copy.kpis.adsLiveUnit(ads.created)}
              </span>
            )}
          </StatCard>

          <StatCard
            label="Render credits"
            icon={<Sparkles size={15} strokeWidth={1.8} />}
            foot={
              <div className="w-full">
                {credits.remaining != null && credits.granted != null ? (
                  <CreditMeter remaining={credits.remaining} granted={credits.granted} />
                ) : (
                  <span>Issued after entitlement setup</span>
                )}
              </div>
            }
          >
            {credits.remaining != null ? (
              <>
                <AnimatedNumber value={credits.remaining} springOptions={COUNT_SPRING} />
                <span className="font-sans text-[13px] font-medium tracking-normal text-muted-foreground">
                  / {credits.granted ?? credits.remaining}
                </span>
              </>
            ) : (
              <span aria-label="Credits not issued yet">—</span>
            )}
          </StatCard>
        </AnimatedGroup>

        {/* One server-resolved activation card remains dominant; performance is secondary. */}
        <AnimatedGroup className="grid grid-cols-1 gap-3.5 lg:grid-cols-[3fr_2fr]" itemClassName="h-full">
          <ActivationCard data={data} />
          <HomePerformanceChart daily={performance?.daily ?? null} />
        </AnimatedGroup>

        {/* Quick actions */}
        <AnimatedGroup className="grid grid-cols-1 gap-3.5 sm:grid-cols-2" itemClassName="h-full">
          {quickActions.map((action) => {
            const Icon = navByVariant.self_serve.find((item) => item.href === action.href)?.icon ?? ArrowRight;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="group flex min-w-0 items-center gap-3.5 rounded-(--r-card) bg-card px-5 py-[18px] shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:hover:translate-y-0"
              >
                <span
                  aria-hidden
                  className="grid size-[42px] shrink-0 place-items-center rounded-[13px] bg-(--accent-tint) text-foreground"
                >
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold">{action.title}</span>
                  <span className="mt-px block truncate text-xs text-muted-foreground">{action.subtitle}</span>
                </span>
                <ArrowRight
                  aria-hidden
                  size={15}
                  strokeWidth={2.2}
                  className="shrink-0 text-(--faint) transition-[transform,color] duration-200 group-hover:translate-x-[3px] group-hover:text-foreground motion-reduce:group-hover:translate-x-0"
                />
              </Link>
            );
          })}
        </AnimatedGroup>
      </AnimatedGroup>
    </div>
  );
}
