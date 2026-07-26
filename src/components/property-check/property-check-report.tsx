"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { buildPropertySnapshot } from "@/lib/property-check/presentation";
import {
  PROPERTY_CHECK_CLIENT_SITUATION_LABELS,
  PROPERTY_CHECK_NO_SOURCE_MESSAGE,
  PROPERTY_CHECK_UNAVAILABLE_MESSAGE,
  type PropertyCheckRecord,
  type PropertyCitation,
  type PropertyConstraint,
  type PropertySignal,
} from "@/lib/property-check/types";

const cardClass = "rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card";
const cardTitleClass = "font-display text-[15.5px] font-extrabold tracking-[-0.015em]";
const ghostButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";
const inkButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-(--ink) px-4 text-[12.5px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.97]";

export function PropertyCheckReport({ check }: { check: PropertyCheckRecord }) {
  const [copied, setCopied] = useState(false);
  const ready = check.status === "success";

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildSummaryText(check));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — leave the button as-is.
    }
  }

  return (
    <article className="grid gap-3.5" aria-label={`Property report for ${check.address}`}>
      <Link
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-muted-foreground transition-colors duration-150 hover:text-foreground"
        href="/property-check"
      >
        <ArrowLeft aria-hidden size={14} />
        Property Check
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] md:text-[24px]">{check.address}</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {PROPERTY_CHECK_CLIENT_SITUATION_LABELS[check.clientSituation]} · Generated {formatDate(check.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[11.5px] font-bold ${
              ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            }`}
          >
            {ready ? <CheckCircle2 aria-hidden size={14} /> : <AlertTriangle aria-hidden size={14} />}
            {ready ? "Ready" : check.status === "engine_unavailable" ? "Unavailable" : "No source result"}
          </span>
          {ready ? (
            <>
              <button type="button" className={ghostButtonClass} onClick={() => void copySummary()}>
                <Copy aria-hidden size={14} />
                {copied ? "Copied" : "Copy summary"}
              </button>
              <button type="button" className={inkButtonClass} onClick={() => window.print()}>
                <Printer aria-hidden size={14} />
                Print / PDF
              </button>
            </>
          ) : null}
        </div>
      </header>

      {ready ? (
        <>
          <ReportSnapshot facts={check.normalizedFacts} />
          <ReportItems
            title="Worth mentioning"
            tone="ok"
            items={check.signals}
            citations={check.citations}
            empty="No cited planning signals were returned for this address."
          />
          <ReportItems
            title="Watch-outs before you promise"
            tone="warn"
            items={check.likelyConstraints}
            citations={check.citations}
            empty="No cited constraints were returned for this address."
          />
          <ReportTalkingPoints points={check.talkingPoints} />
          <ReportSources citations={check.citations} />
        </>
      ) : (
        <div
          className="flex flex-col items-center gap-2.5 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-12 text-center"
          role="status"
        >
          <AlertTriangle aria-hidden size={22} className="text-warning" />
          <p className="max-w-[420px] text-[13px]/relaxed text-muted-foreground">
            {check.status === "engine_unavailable" ? PROPERTY_CHECK_UNAVAILABLE_MESSAGE : PROPERTY_CHECK_NO_SOURCE_MESSAGE}
          </p>
        </div>
      )}

      <p className="text-[11px]/relaxed text-(--faint)">{check.disclaimer}</p>
    </article>
  );
}

function ReportSnapshot({ facts }: { facts: Record<string, unknown> }) {
  const entries = buildPropertySnapshot(facts);

  if (entries.length === 0) return null;

  return (
    <section className={cardClass}>
      <h2 className={cardTitleClass}>Property snapshot</h2>
      <dl className="mt-3.5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <div key={entry.label}>
            <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{entry.label}</dt>
            <dd className="mt-1 text-[13.5px] font-bold text-foreground">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReportItems({
  title,
  tone,
  items,
  citations,
  empty,
}: {
  title: string;
  tone: "ok" | "warn";
  items: Array<PropertySignal | PropertyConstraint>;
  citations: PropertyCitation[];
  empty: string;
}) {
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));

  return (
    <section className={cardClass}>
      <h2 className={cardTitleClass}>{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-3.5 grid gap-2.5">
          {items.map((item) => (
            <div className="flex gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/50 p-3.5" key={item.id}>
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                  tone === "ok" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
                }`}
                aria-hidden
              >
                {tone === "ok" ? "✓" : "!"}
              </span>
              <div className="min-w-0">
                <b className="text-[13px] font-bold text-foreground">{item.title}</b>
                <p className="mt-0.5 text-xs/relaxed text-muted-foreground">{item.summary}</p>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {item.citationIds.map((citationId) => {
                    const citation = citationById.get(citationId);
                    return (
                      <span
                        key={citationId}
                        className="inline-flex h-5 items-center rounded-full border border-(--line) bg-(--surface) px-2 text-[10px] font-bold text-muted-foreground"
                      >
                        {citation?.title ?? citationId}
                      </span>
                    );
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportTalkingPoints({ points }: { points: string[] }) {
  if (points.length === 0) return null;

  return (
    <section className={cardClass}>
      <h2 className={cardTitleClass}>Talking points for the conversation</h2>
      <ol className="mt-3.5 grid list-decimal gap-2 pl-5 marker:font-display marker:text-[13px] marker:font-extrabold marker:text-(--faint)">
        {points.map((point) => (
          <li key={point} className="pl-1 text-[13px]/relaxed text-foreground">
            {point}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReportSources({ citations }: { citations: PropertyCitation[] }) {
  if (citations.length === 0) return null;

  return (
    <section className={cardClass}>
      <h2 className={cardTitleClass}>Sources</h2>
      <div className="mt-3.5 grid gap-2">
        {citations.map((citation) => (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/50 px-3.5 py-2.5"
            key={citation.id}
          >
            <b className="text-[12.5px] font-bold text-foreground">{citation.title}</b>
            <span className="text-[11px] text-(--faint)">{formatLabel(citation.sourceType)}</span>
            {citation.url ? (
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-bold text-data hover:underline"
              >
                Open
                <ExternalLink aria-hidden size={12} />
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function buildSummaryText(check: PropertyCheckRecord): string {
  const lines: string[] = [
    `Property check — ${check.address}`,
    `Generated ${formatDate(check.createdAt)} (${PROPERTY_CHECK_CLIENT_SITUATION_LABELS[check.clientSituation]})`,
    "",
  ];

  const facts = buildPropertySnapshot(check.normalizedFacts);
  if (facts.length > 0) {
    lines.push("Snapshot:");
    for (const fact of facts) lines.push(`- ${fact.label}: ${fact.value}`);
    lines.push("");
  }
  if (check.signals.length > 0) {
    lines.push("Worth mentioning:");
    for (const signal of check.signals) lines.push(`- ${signal.title}: ${signal.summary}`);
    lines.push("");
  }
  if (check.likelyConstraints.length > 0) {
    lines.push("Watch-outs:");
    for (const constraint of check.likelyConstraints) lines.push(`- ${constraint.title}: ${constraint.summary}`);
    lines.push("");
  }
  if (check.talkingPoints.length > 0) {
    lines.push("Talking points:");
    for (const point of check.talkingPoints) lines.push(`- ${point}`);
    lines.push("");
  }
  lines.push(check.disclaimer);
  return lines.join("\n");
}

function formatLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part.toLowerCase()))
    .join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
