"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { HomeMetricsBand } from "@/components/self-serve/home-metrics-band";
import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { SafeImage } from "@/components/ui/safe-image";
import { niche } from "@/config/niche";
import type { HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
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
  leads: Array<{
    id: string;
    name: string;
    suburb: string;
    source: string;
    createdAt: string;
  }>;
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

const ROW_ARROW =
  "shrink-0 text-(--faint) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0";

/**
 * How long a lead has been sitting untouched. The workspace has no CRM contact
 * state yet, so waiting time is the only follow-up signal that can be stated
 * without inventing one. It is one label rather than a waiting chip plus a
 * second timestamp, because both said the same thing.
 */
function waitingLabel(iso: string): { text: string; stale: boolean } | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const days = Math.floor((Date.now() - parsed) / 86_400_000);
  if (days < 1) return { text: "Waiting since today", stale: false };
  if (days === 1) return { text: "Waiting 1 day", stale: false };
  return { text: `Waiting ${days} days`, stale: days >= 2 };
}

function LeadsSection({ leads }: { leads: HomeData["leads"] }) {
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
          <span className="text-[12.5px] text-(--faint)">{copy.followUp(leads.length)}</span>
        </div>
        <Link href="/leads" className={cn(SECTION_LINK, "shrink-0")}>
          {copy.viewAll}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line)">
        {leads.map((lead) => {
          const waiting = waitingLabel(lead.createdAt);
          return (
            <li key={lead.id}>
              <Link href="/leads" className={ROW_LINK}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13.5px] font-semibold text-foreground">
                    {lead.name}
                  </span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {lead.suburb} · {lead.source}
                  </span>
                </div>
                {waiting ? (
                  <span
                    className={cn(
                      "shrink-0 text-[11.5px] font-semibold tabular-nums",
                      // Staleness is carried by the words; the amber only
                      // reinforces it, and both tones stay above AA contrast.
                      waiting.stale ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    {waiting.text}
                  </span>
                ) : null}
                <ArrowRight size={16} aria-hidden className={ROW_ARROW} />
              </Link>
            </li>
          );
        })}
      </ul>
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
        <h2 className={cn(SECTION_TITLE, "min-w-0")}>{copy.title(area.place)}</h2>
        <Link
          href={`/ad-radar?q=${encodeURIComponent(area.searchTerm)}`}
          className={cn(SECTION_LINK, "shrink-0")}
        >
          {copy.viewAll}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <ul className="mt-3 list-none divide-y divide-(--line) border-y border-(--line)">
        {ads.map((ad) => (
          <li key={ad.id}>
            <Link href={`/ad-radar/ads/${encodeURIComponent(ad.id)}`} className={ROW_LINK}>
              <span className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-(--r-ctl) bg-(--surface-subtle)">
                {ad.imageUrl ? (
                  <SafeImage
                    src={ad.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    compactFallback
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-(--faint)">
                    Ad
                  </span>
                )}
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
        <LeadsSection leads={data.leads} />
      </motion.section>

      <motion.section variants={itemVariants}>
        <LocalAdsSection ads={data.localAds} area={data.localAdsArea} />
      </motion.section>
    </motion.div>
  );
}
