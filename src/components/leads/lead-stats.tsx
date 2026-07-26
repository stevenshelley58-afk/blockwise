"use client";

/*
 * Leads metric tiles (mockup `stats-3`): plain label + count-up value,
 * high-intent share as a unit, duplicates with its matching note.
 */

import { AnimatedGroup } from "@/components/ui/animated-group";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { niche } from "@/config/niche";
import { countUpDuration, springs } from "@/lib/motion";

const COUNT_SPRING = { ...springs.slow, duration: countUpDuration };

export function LeadStats({
  total,
  highIntent,
  duplicates,
}: {
  total: number;
  highIntent: number;
  duplicates: number;
}) {
  const copy = niche.copy.leads.stats;
  const highIntentPct = total > 0 ? Math.round((highIntent / total) * 100) : 0;

  return (
    <AnimatedGroup className="grid gap-3.5 sm:grid-cols-3" itemClassName="h-full">
      <div className="rounded-(--r-card) bg-card px-[18px] pt-[17px] pb-[15px] shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:hover:translate-y-0">
        <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          {copy.leads}
        </span>
        <p className="mt-2.5 font-display text-[26px] leading-[1.1] font-extrabold tracking-[-0.02em]">
          <AnimatedNumber value={total} springOptions={COUNT_SPRING} />
        </p>
      </div>

      <div className="rounded-(--r-card) bg-card px-[18px] pt-[17px] pb-[15px] shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:hover:translate-y-0">
        <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          {copy.highIntent}
        </span>
        <p className="mt-2.5 flex items-baseline gap-[7px] font-display text-[26px] leading-[1.1] font-extrabold tracking-[-0.02em]">
          <AnimatedNumber value={highIntent} springOptions={COUNT_SPRING} />
          <span className="font-sans text-[13px] font-medium tracking-normal text-muted-foreground">
            {highIntentPct}%
          </span>
        </p>
      </div>

      <div className="rounded-(--r-card) bg-card px-[18px] pt-[17px] pb-[15px] shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:hover:translate-y-0">
        <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          {copy.duplicates}
        </span>
        <p className="mt-2.5 font-display text-[26px] leading-[1.1] font-extrabold tracking-[-0.02em]">
          <AnimatedNumber value={duplicates} springOptions={COUNT_SPRING} />
        </p>
        <p className="mt-[7px] text-[11.5px] text-muted-foreground">{copy.duplicatesNote}</p>
      </div>
    </AnimatedGroup>
  );
}
