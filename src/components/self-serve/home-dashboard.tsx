"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { navByVariant } from "@/components/sidebar-nav";
import { niche } from "@/config/niche";

import { ActivationCard, WorkspaceDetails, type ActivationCardData } from "./activation-card";
import { ActionRow, MobileSection } from "@/components/ui/mobile-workspace";
import type { HomeDailyPoint } from "./home-chart";

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
};

const money = (value: number) => `$${value.toFixed(2)}`;

function reportingFoot(lastSyncedAt: string | null): string {
  if (!lastSyncedAt || !Number.isFinite(Date.parse(lastSyncedAt))) return "Provider time unavailable";
  const formatted = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(lastSyncedAt));
  return `Last known provider data: ${formatted} UTC`;
}

function Delta({ current, previous, downIsGood = false }: { current: number | null; previous: number | null; downIsGood?: boolean }) {
  if (current == null || previous == null || previous === 0) return null;
  const change = (current - previous) / previous;
  if (!Number.isFinite(change) || Math.abs(change) < 0.005) return null;
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const good = downIsGood ? !up : up;
  return <span className={good ? "text-success" : "text-error"}><Icon aria-hidden className="inline size-3" /> {Math.round(Math.abs(change) * 100)}%</span>;
}

function ResultMetric({ label, value, foot, unavailable = false }: { label: string; value: string; foot?: React.ReactNode; unavailable?: boolean }) {
  return (
    <div className="min-w-0 border-r border-(--line) px-3 py-2.5 first:pl-0 last:border-r-0 last:pr-0 sm:px-4 sm:first:pl-0 sm:last:pr-0">
      <span className="block text-[13px] font-semibold leading-4 text-muted-foreground">{label}</span>
      <p className={`mt-1 font-display font-extrabold tabular-nums tracking-[-0.02em] ${unavailable ? "text-[16px]" : "text-[clamp(1rem,6.2vw,1.5rem)]"}`} aria-label={unavailable ? `${label} unavailable` : undefined} title={value}>{value}</p>
      {foot ? <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{foot}</p> : null}
    </div>
  );
}

function ReportingRecovery({ state }: { state: string }) {
  if (state === "not_connected") {
    return <><span>Connect Meta to see enquiry reporting.</span> <Link href="/settings#connections" className="font-semibold underline underline-offset-4">Connect Meta</Link></>;
  }
  if (state === "needs_attention") {
    return <><span>Meta reporting needs attention.</span> <Link href="/settings#connections" className="font-semibold underline underline-offset-4">Review connection</Link></>;
  }
  return <><span>Provider reporting is unavailable right now.</span> <Link href="/ad-studio" className="font-semibold underline underline-offset-4">Create an ad</Link></>;
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const copy = niche.copy.home;
  const { credits, ads, performance } = data;
  const quickActions = copy.quickActions.filter((action) => !action.feature || niche.features[action.feature]);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 md:pt-7 md:pb-12">
      <div className="grid gap-0">
        <div className="pb-4">
          <h1 className="hidden font-display text-[24px] font-extrabold tracking-[-0.02em] md:block md:text-[27px]">Home</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{data.workspaceName}</p>
        </div>

        {/* One server-resolved activation card remains dominant. */}
        <ActivationCard data={data} />

        {/* KPI row */}
        <MobileSection title="Results" className="mt-1">
          {performance ? (
            <>
              <p className="mb-3 text-[12.5px] text-muted-foreground" role="status">Last 30 days. {reportingFoot(performance.lastSyncedAt)}.</p>
              <div className="grid grid-cols-3 gap-0">
                <ResultMetric label={copy.kpis.leads} value={String(performance.leads)} foot={<>{performance.previousLeads == null ? "Provider data" : <><Delta current={performance.leads} previous={performance.previousLeads} /> vs prior</>}</>} />
                <ResultMetric label={copy.kpis.costPerLead} value={performance.cpl == null ? "N/A" : money(performance.cpl)} unavailable={performance.cpl == null} foot={performance.cpl == null ? "No cost data yet" : <><Delta current={performance.cpl} previous={performance.previousCpl} downIsGood /> vs prior</>} />
                <ResultMetric label={ads.live == null ? copy.kpis.adsCreated : copy.kpis.adsLive} value={String(ads.live ?? ads.created)} foot={ads.created > 0 ? copy.kpis.publishedThisWeek(ads.publishedThisWeek) : copy.kpis.noAdsYet} />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground" role="status"><span aria-label="Enquiry reporting unavailable">Unavailable</span>. <ReportingRecovery state={data.meta.state} /></p>
          )}
        </MobileSection>

        {quickActions.length > 0 ? <MobileSection title="Tools"><div>{quickActions.map((action) => { const Icon = navByVariant.self_serve.find((item) => item.href === action.href)?.icon ?? ArrowRight; return <ActionRow key={action.href} href={action.href} icon={<Icon size={17} />} title={action.title} subtitle={action.subtitle} />; })}</div></MobileSection> : null}

        <WorkspaceDetails credits={credits} plan={data.plan} meta={data.meta} booking={data.booking} packEstimate={credits.remaining == null ? null : Math.floor(credits.remaining / 2)} />
      </div>
    </div>
  );
}
