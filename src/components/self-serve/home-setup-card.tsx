"use client";

/*
 * Home setup card (Premium v2 mockup): animated progress ring + three-step
 * checklist (brand pack → connect Meta → first ad) with drawn checks, an
 * "Up next" highlight, and a ready-to-publish state once everything is done.
 * All copy comes from the niche config — no product nouns live here.
 */

import { motion } from "motion/react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { niche } from "@/config/niche";
import { springs, useReducedMotion } from "@/lib/motion";

import { ProgressRing } from "./progress-ring";

type StepKey = "brand" | "connect" | "publish";

type StepState = {
  key: StepKey;
  href: string;
  done: boolean;
};

function DrawnCheck({ delay }: { delay: number }) {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="size-[13px]" aria-hidden>
      <motion.path
        d="M5 13l4.5 4.5L19 7"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ ...springs.gentle, delay }}
      />
    </svg>
  );
}

export function HomeSetupCard({
  hasBrand,
  hasProvider,
  adsCreated,
}: {
  hasBrand: boolean;
  hasProvider: boolean;
  adsCreated: number;
}) {
  const copy = niche.copy.home.setup;

  const steps: StepState[] = [
    { key: "brand", href: "/ad-studio/brand", done: hasBrand },
    { key: "connect", href: "/settings#connections", done: hasProvider },
    { key: "publish", href: "/ad-studio?newAd=1", done: adsCreated > 0 },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const total = steps.length;
  const allDone = doneCount === total;
  const currentIndex = steps.findIndex((step) => !step.done);

  return (
    <section
      aria-label={copy.title}
      className="flex h-full flex-col rounded-(--r-panel) bg-card shadow-card"
    >
      <div className="flex items-start justify-between gap-2.5 px-5 pt-5 md:px-[22px]">
        <div>
          <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em]">{copy.title}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {allDone ? copy.readySubtitle : copy.subtitle}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-4 pb-5 md:px-[22px]">
        <div className="flex items-center gap-3.5">
          <ProgressRing
            value={(doneCount / total) * 100}
            size={64}
            strokeWidth={6}
            label={copy.progressLabel(doneCount, total)}
          />
          <p className="text-[12.5px] text-muted-foreground">
            <strong className="block font-display text-[15.5px] font-extrabold tracking-[-0.01em] text-foreground">
              {allDone ? copy.readyTitle : copy.progressLabel(doneCount, total)}
            </strong>
            {allDone ? copy.readySubtitle : copy.subtitle}
          </p>
        </div>

        {allDone ? (
          <div className="mt-4 flex flex-1 flex-col">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.readyBody}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <ButtonArrow href="/ad-studio?newAd=1" className="h-11 text-[13px]">
                {niche.copy.home.states.ready.ctaLabel}
              </ButtonArrow>
              <Link
                href="/ad-studio"
                className="inline-flex h-11 items-center rounded-full border border-(--line-heavy) bg-card px-5 text-[13px] font-bold text-foreground transition-colors duration-150 hover:bg-(--surface-subtle)"
              >
                {copy.adLibrary}
              </Link>
            </div>
            <Link
              href="/results"
              className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[12.5px] font-bold text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              {copy.viewPerformance}
              <ArrowRight aria-hidden size={13} />
            </Link>
          </div>
        ) : (
          <ol className="mt-3.5 grid list-none gap-1">
            {steps.map((step, index) => {
              const stepCopy = copy.steps[step.key];
              const isCurrent = index === currentIndex;
              const state = step.done ? "done" : isCurrent ? "current" : "todo";

              const inner = (
                <>
                  <span
                    aria-hidden
                    className={
                      state === "done"
                        ? "grid size-7 shrink-0 place-items-center rounded-full bg-success-soft text-success"
                        : state === "current"
                          ? "grid size-7 shrink-0 place-items-center rounded-full bg-(--ink) text-[12px] font-bold text-white"
                          : "grid size-7 shrink-0 place-items-center rounded-full border border-(--line) bg-(--surface-subtle) text-[12px] font-bold text-(--faint)"
                    }
                  >
                    {step.done ? <DrawnCheck delay={0.5 + index * 0.15} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug font-bold">{stepCopy.title}</span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">
                      {stepCopy.description}
                    </span>
                  </span>
                  <span
                    className={
                      state === "done"
                        ? "shrink-0 rounded-full bg-success-soft px-2.5 py-[3px] text-[10.5px] font-bold text-success"
                        : state === "current"
                          ? "shrink-0 rounded-full bg-card px-2.5 py-[3px] text-[10.5px] font-bold text-foreground"
                          : "shrink-0 rounded-full bg-(--surface-subtle) px-2.5 py-[3px] text-[10.5px] font-bold text-(--faint)"
                    }
                  >
                    {step.done ? stepCopy.doneLabel : isCurrent ? copy.badges.upNext : copy.badges.waiting}
                  </span>
                </>
              );

              const rowClasses = `flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 ${
                isCurrent ? "bg-(--accent-tint)" : ""
              }`;

              return (
                <li key={step.key}>
                  {step.done ? (
                    <div className={rowClasses}>{inner}</div>
                  ) : (
                    <Link href={step.href} className={`${rowClasses} hover:bg-(--surface-subtle)`}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
