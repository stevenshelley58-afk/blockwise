"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";

import type { HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import type { ActivationCardData } from "./activation-card";
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

  return (
    <div data-home-creative
      className="mx-auto w-full max-w-[1120px] px-4 pb-6 pt-5 md:px-6 md:pb-12 md:pt-7">
      <section aria-labelledby="home-creative-heading">
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
    </div>
  );
}
