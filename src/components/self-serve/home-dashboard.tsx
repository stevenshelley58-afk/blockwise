"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { MetaAdTile } from "@/components/research/meta-ad-tile";
import { HomeMetricsBand } from "@/components/self-serve/home-metrics-band";
import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { NoticeBar } from "@/components/ui/notice-bar";
import { SafeImage } from "@/components/ui/safe-image";
import { niche } from "@/config/niche";
import type { HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import type { HomeLead } from "@/lib/home/home-lead-row";
import type { HomeLocalAd } from "@/lib/home/home-local-ads";
import { entrance, useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
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
    weekly: { spend: number; clicks: number; cpc: number | null; leads: number };
    /** True when every number above is a labelled preview, not this workspace's delivery. */
    isSample: boolean;
    lastSyncedAt: string | null;
  } | null;
  creativeSuggestions?: HomeCreativeSuggestions;
  leads: HomeLead[];
  /** True when those rows are examples for a demo workspace, not this workspace's leads. */
  leadsAreExamples: boolean;
  localAds: HomeLocalAd[];
  /**
   * The area those ads were read for: the workspace's own suburb or postcode
   * when the brand address supplied one, otherwise the niche's default area.
   * Null only when the list is empty.
   */
  localAdsArea: { place: string; searchTerm: string } | null;
};

/** The section heading scale, so the band and the lists read as one page. */
const SECTION_TITLE =
  "font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-foreground";

const SECTION_LINK =
  "inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROW_LINK =
  "group flex min-h-[64px] items-center gap-3 py-2.5 transition-colors duration-150 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** An example row: the same shape as a lead row, with nothing to open. */
const ROW_STATIC = "flex min-h-[64px] items-center gap-3 py-2.5";

const ROW_ARROW =
  "shrink-0 text-(--faint) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0";

/**
 * A lead's follow-up state. The CRM owns this once one is connected, so a row
 * with a CRM status shows it; a row without one falls back to how long it has
 * been waiting, which is the only signal the workspace itself can state.
 */
function followUp(lead: HomeLead): { text: string; tone: "status" | "waiting" | "stale" } | null {
  if (lead.status) return { text: lead.status, tone: "status" };

  const parsed = Date.parse(lead.createdAt);
  if (!Number.isFinite(parsed)) return null;
  const days = Math.floor((Date.now() - parsed) / 86_400_000);
  if (days < 1) return { text: "Waiting since today", tone: "waiting" };
  if (days === 1) return { text: "Waiting 1 day", tone: "waiting" };
  return { text: `Waiting ${days} days`, tone: days >= 2 ? "stale" : "waiting" };
}

function LeadsSection({
  leads,
  areExamples,
}: {
  leads: HomeData["leads"];
  areExamples: boolean;
}) {
  const copy = niche.copy.home.leads;
  if (leads.length === 0) {
    return (
      <section className="mt-10 md:mt-12">
        <h2 className={SECTION_TITLE}>{copy.title}</h2>
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
    <section className="mt-10 md:mt-12">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className={SECTION_TITLE}>{copy.title}</h2>
          {areExamples ? null : (
            <span className="text-[12.5px] text-(--faint)">{copy.followUp(leads.length)}</span>
          )}
        </div>
        {/* Example leads have nowhere to go: the Leads page holds this
            workspace's own, and it has none yet. The section offers the one
            action that changes that instead. */}
        {areExamples ? null : (
          <Link href="/leads" className={cn(SECTION_LINK, "shrink-0")}>
            {copy.viewAll}
            <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>

      <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line)">
        {leads.map((lead) => {
          const state = followUp(lead);
          const row = (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-foreground">
                  {lead.name}
                </span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {lead.suburb} · {lead.source}
                </span>
              </div>
              {state ? (
                <span
                  className={cn(
                    "shrink-0 text-[11.5px] font-semibold",
                    state.tone === "status" ? "text-foreground" : "tabular-nums",
                    // Staleness is carried by the words; the amber only
                    // reinforces it, and both tones stay above AA contrast.
                    state.tone === "stale" ? "text-warning" : null,
                    state.tone === "waiting" ? "text-muted-foreground" : null,
                  )}
                >
                  {state.text}
                </span>
              ) : null}
            </>
          );

          return (
            <li key={lead.id}>
              {/* An example row leads nowhere: the Leads page holds this
                  workspace's own, and it has none. */}
              {areExamples ? (
                <div className={ROW_STATIC}>{row}</div>
              ) : (
                <Link href="/leads" className={ROW_LINK}>
                  {row}
                  <ArrowRight size={16} aria-hidden className={ROW_ARROW} />
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {/* Examples are labelled under the rows, the way the weekly figures are
          labelled under theirs, and the bar carries the one action that would
          replace them with the workspace's own leads. */}
      {areExamples ? (
        <NoticeBar
          text={copy.demoNote}
          action={{ href: "/ad-studio", label: copy.ctaLabel }}
        />
      ) : null}
    </section>
  );
}

function LocalAdsSection({
  ads,
  area,
}: {
  ads: HomeData["localAds"];
  area: HomeData["localAdsArea"];
}) {
  const copy = niche.copy.home.localAds;
  if (ads.length === 0 || area === null) return null;

  return (
    <section className="mt-10 md:mt-12">
      <div className="flex items-center justify-between gap-4">
        <h2 className={cn(SECTION_TITLE, "min-w-0")}>{copy.title}</h2>
        <Link
          href={`/ad-radar?q=${encodeURIComponent(area.searchTerm)}`}
          className={cn(SECTION_LINK, "shrink-0")}
        >
          {copy.viewAll}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      {/* Phone: four rows, one ad each, which is a lot of detail in little
          space. From `lg` the same ads become the cards Ad Radar shows them
          as, four to a row, because there is width for a picture by then. */}
      <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line) lg:hidden">
        {ads.map((ad) => (
          <li key={ad.id}>
            <Link href={`/ad-radar/ads/${encodeURIComponent(ad.id)}`} className={ROW_LINK}>
              <span className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-(--r-ctl) bg-(--surface-subtle)">
                <SafeImage
                  src={ad.imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  compactFallback
                />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-foreground">
                  {ad.pageName}
                </span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {ad.headline ?? "Ad"} ·{" "}
                  {ad.suburb ? `${ad.suburb}, ${ad.state ?? "WA"}` : area.place}
                </span>
              </div>
              <ArrowRight size={16} aria-hidden className={ROW_ARROW} />
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-4">
        {ads.map((ad) => (
          <MetaAdTile
            key={ad.id}
            href={`/ad-radar/ads/${encodeURIComponent(ad.id)}`}
            thumbnailUrl={ad.imageUrl}
            card={ad}
          />
        ))}
      </div>
    </section>
  );
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const reduced = useReducedMotion();
  const { container, item: itemVariants } = entrance(reduced);

  return (
    <motion.div
      data-home-creative
      variants={container}
      initial="hidden"
      animate="visible"
      className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16"
    >
      <motion.section variants={itemVariants}>
        <HomeMetricsBand performance={data.performance} hasProvider={data.hasProvider} />
      </motion.section>

      <motion.section variants={itemVariants}>
        <LeadsSection leads={data.leads} areExamples={data.leadsAreExamples} />
      </motion.section>

      <motion.section variants={itemVariants}>
        <LocalAdsSection ads={data.localAds} area={data.localAdsArea} />
      </motion.section>
    </motion.div>
  );
}
