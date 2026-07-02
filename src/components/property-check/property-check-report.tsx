"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  PROPERTY_CHECK_CLIENT_SITUATION_LABELS,
  PROPERTY_CHECK_NO_SOURCE_MESSAGE,
  PROPERTY_CHECK_UNAVAILABLE_MESSAGE,
  type PropertyCheckRecord,
  type PropertyCitation,
  type PropertyConstraint,
  type PropertySignal,
} from "@/lib/property-check/types";

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
    <article className="pc-report" aria-label={`Property report for ${check.address}`}>
      <Link className="pc-report-back" href="/property-check">
        <ArrowLeft aria-hidden size={15} />
        Property Check
      </Link>

      <header className="pc-report-head">
        <div>
          <h1>{check.address}</h1>
          <p className="pc-report-meta">
            {PROPERTY_CHECK_CLIENT_SITUATION_LABELS[check.clientSituation]} · Generated {formatDate(check.createdAt)}
          </p>
        </div>
        <div className="pc-report-actions">
          <span className={ready ? "pc-report-status ok" : "pc-report-status warn"}>
            {ready ? <CheckCircle2 aria-hidden size={14} /> : <AlertTriangle aria-hidden size={14} />}
            {ready ? "Ready" : check.status === "engine_unavailable" ? "Unavailable" : "No source result"}
          </span>
          {ready ? (
            <>
              <button type="button" className="btn" onClick={() => void copySummary()}>
                <Copy aria-hidden size={15} />
                {copied ? "Copied" : "Copy summary"}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                <Printer aria-hidden size={15} />
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
        <div className="pc-report-card pc-report-safe" role="status">
          <AlertTriangle aria-hidden size={22} />
          <p>{check.status === "engine_unavailable" ? PROPERTY_CHECK_UNAVAILABLE_MESSAGE : PROPERTY_CHECK_NO_SOURCE_MESSAGE}</p>
        </div>
      )}

      <p className="pc-report-disclaimer">{check.disclaimer}</p>
    </article>
  );
}

function ReportSnapshot({ facts }: { facts: Record<string, unknown> }) {
  const entries = useMemo(
    () =>
      Object.entries(facts)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .slice(0, 12),
    [facts],
  );

  if (entries.length === 0) return null;

  return (
    <section className="pc-report-card">
      <h2>Property snapshot</h2>
      <dl className="pc-report-facts">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{formatLabel(key)}</dt>
            <dd>{formatValue(value)}</dd>
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
    <section className="pc-report-card">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="pc-report-muted">{empty}</p>
      ) : (
        <div className="pc-report-items">
          {items.map((item) => (
            <div className={`pc-report-item ${tone}`} key={item.id}>
              <span className="pc-report-item-dot" aria-hidden>
                {tone === "ok" ? "✓" : "!"}
              </span>
              <div>
                <b>{item.title}</b>
                <p>{item.summary}</p>
                <span className="pc-report-cites">
                  {item.citationIds.map((citationId) => {
                    const citation = citationById.get(citationId);
                    return <span key={citationId}>{citation?.title ?? citationId}</span>;
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
    <section className="pc-report-card">
      <h2>Talking points for the conversation</h2>
      <ol className="pc-report-talk">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>
    </section>
  );
}

function ReportSources({ citations }: { citations: PropertyCitation[] }) {
  if (citations.length === 0) return null;

  return (
    <section className="pc-report-card">
      <h2>Sources</h2>
      <div className="pc-report-sources">
        {citations.map((citation) => (
          <div className="pc-report-source" key={citation.id}>
            <b>{citation.title}</b>
            <span>{formatLabel(citation.sourceType)}</span>
            {citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                Open
                <ExternalLink aria-hidden size={13} />
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

  const facts = Object.entries(check.normalizedFacts).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (facts.length > 0) {
    lines.push("Snapshot:");
    for (const [key, value] of facts) lines.push(`- ${formatLabel(key)}: ${formatValue(value)}`);
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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "number") return new Intl.NumberFormat("en-AU").format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
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
