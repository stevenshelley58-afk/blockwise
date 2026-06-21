"use client";

import { AlertTriangle, CheckCircle2, Clock3, FileSearch, LinkIcon, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import {
  PROPERTY_CHECK_CLIENT_SITUATION_LABELS,
  PROPERTY_CHECK_CLIENT_SITUATIONS,
  PROPERTY_CHECK_NO_SOURCE_MESSAGE,
  PROPERTY_CHECK_UNAVAILABLE_MESSAGE,
  type PropertyCheckClientSituation,
  type PropertyCheckRecord,
  type PropertyCitation,
  type PropertyConstraint,
  type PropertySignal,
} from "@/lib/property-check/types";

type SubmitState = "idle" | "submitting";

type ApiResponse = {
  check?: PropertyCheckRecord;
  error?: string;
};

export function PropertyCheckWorkspace({ initialChecks }: { initialChecks: PropertyCheckRecord[] }) {
  const [checks, setChecks] = useState(initialChecks);
  const [activeCheck, setActiveCheck] = useState<PropertyCheckRecord | null>(initialChecks[0] ?? null);
  const [address, setAddress] = useState("");
  const [clientSituation, setClientSituation] = useState<PropertyCheckClientSituation>("seller_appraisal");
  const [notes, setNotes] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const canSubmit = address.trim().length >= 3 && submitState !== "submitting";

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitState("submitting");
    setError(null);

    const response = await fetch("/api/property-checks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        clientSituation,
        notes: notes.trim() || undefined,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as ApiResponse;

    setSubmitState("idle");

    if (!response.ok || !payload.check) {
      setError(payload.error ?? "Property Check could not be run right now.");
      return;
    }

    setChecks((current) => [payload.check as PropertyCheckRecord, ...current.filter((check) => check.id !== payload.check?.id)]);
    setActiveCheck(payload.check);
    setAddress("");
    setNotes("");
  }

  return (
    <section className="property-check-layout" aria-label="Property Check workspace">
      <div className="panel property-check-form-panel">
        <div className="property-check-panel-head">
          <FileSearch aria-hidden size={22} />
          <div>
            <h2>Run a property check</h2>
            <p>Use source-cited notes for conversation prep. Review before relying on results.</p>
          </div>
        </div>

        <form className="property-check-form" onSubmit={(event) => void submitCheck(event)}>
          <label className="property-check-field">
            <span>Address</span>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="12 Example Street, Suburb WA"
              minLength={3}
              maxLength={500}
              required
            />
          </label>

          <label className="property-check-field">
            <span>Client situation</span>
            <select
              value={clientSituation}
              onChange={(event) => setClientSituation(event.target.value as PropertyCheckClientSituation)}
            >
              {PROPERTY_CHECK_CLIENT_SITUATIONS.map((situation) => (
                <option value={situation} key={situation}>
                  {PROPERTY_CHECK_CLIENT_SITUATION_LABELS[situation]}
                </option>
              ))}
            </select>
          </label>

          <label className="property-check-field">
            <span>Notes or client question</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional context for the client conversation"
              maxLength={1500}
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="btn btn-primary property-check-submit" type="submit" disabled={!canSubmit}>
            <Search aria-hidden size={18} />
            {submitState === "submitting" ? "Running check" : "Run check"}
          </button>
        </form>
      </div>

      <PropertyCheckResultPanel check={activeCheck} />

      <aside className="panel property-check-history" aria-label="Recent property checks">
        <h2>Recent checks</h2>
        {checks.length === 0 ? (
          <p className="property-check-muted">Property checks will appear here after you run them.</p>
        ) : (
          <div className="property-check-history-list">
            {checks.map((check) => (
              <button
                type="button"
                className={activeCheck?.id === check.id ? "property-check-history-item active" : "property-check-history-item"}
                onClick={() => setActiveCheck(check)}
                key={check.id}
              >
                <span>{check.address}</span>
                <small>{formatDate(check.createdAt)}</small>
              </button>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}

function PropertyCheckResultPanel({ check }: { check: PropertyCheckRecord | null }) {
  if (!check) {
    return (
      <div className="panel property-check-result property-check-empty">
        <FileSearch aria-hidden size={28} />
        <h2>No property check selected</h2>
        <p>Enter an address to generate preliminary planning signals and source-cited agent notes.</p>
      </div>
    );
  }

  const safeState = check.status !== "success";

  return (
    <div className="panel property-check-result">
      <div className="property-check-result-head">
        <div>
          <p className="eyebrow">Result</p>
          <h2>{check.address}</h2>
          <p>
            {PROPERTY_CHECK_CLIENT_SITUATION_LABELS[check.clientSituation]} · Generated {formatDate(check.createdAt)}
          </p>
        </div>
        <StatusBadge status={check.status} />
      </div>

      {safeState ? (
        <div className="property-check-safe-state" role="status">
          <AlertTriangle aria-hidden size={22} />
          <p>{check.status === "engine_unavailable" ? PROPERTY_CHECK_UNAVAILABLE_MESSAGE : PROPERTY_CHECK_NO_SOURCE_MESSAGE}</p>
        </div>
      ) : (
        <>
          <FactGrid facts={check.normalizedFacts} />
          <PlanningList title="Planning signals" items={check.signals} citations={check.citations} empty="No cited planning signals returned." />
          <PlanningList
            title="Likely constraints"
            items={check.likelyConstraints}
            citations={check.citations}
            empty="No cited likely constraints returned."
          />
          <TalkingPoints points={check.talkingPoints} />
          <CitationList citations={check.citations} />
        </>
      )}

      <p className="property-check-disclaimer">{check.disclaimer}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: PropertyCheckRecord["status"] }) {
  const statusMeta = {
    success: { label: "Ready", className: "status green", icon: CheckCircle2 },
    no_source: { label: "No source result", className: "status amber", icon: AlertTriangle },
    unsupported: { label: "Unsupported", className: "status amber", icon: AlertTriangle },
    engine_unavailable: { label: "Unavailable", className: "status rose", icon: Clock3 },
  }[status];
  const Icon = statusMeta.icon;

  return (
    <span className={statusMeta.className}>
      <Icon aria-hidden size={14} />
      {statusMeta.label}
    </span>
  );
}

function FactGrid({ facts }: { facts: Record<string, unknown> }) {
  const entries = useMemo(
    () =>
      Object.entries(facts)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .slice(0, 12),
    [facts],
  );

  if (entries.length === 0) {
    return <p className="property-check-muted">No normalized property facts returned.</p>;
  }

  return (
    <dl className="property-check-facts" aria-label="Normalized property facts">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{formatLabel(key)}</dt>
          <dd>{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlanningList({
  title,
  items,
  citations,
  empty,
}: {
  title: string;
  items: Array<PropertySignal | PropertyConstraint>;
  citations: PropertyCitation[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <section className="property-check-section">
        <h3>{title}</h3>
        <p className="property-check-muted">{empty}</p>
      </section>
    );
  }

  return (
    <section className="property-check-section">
      <h3>{title}</h3>
      <div className="property-check-item-list">
        {items.map((item) => (
          <article className="property-check-item" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.summary}</p>
            </div>
            <CitationChips citationIds={item.citationIds} citations={citations} />
          </article>
        ))}
      </div>
    </section>
  );
}

function CitationChips({ citationIds, citations }: { citationIds: string[]; citations: PropertyCitation[] }) {
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));

  return (
    <div className="property-check-citation-chips" aria-label="Citations">
      {citationIds.map((citationId) => {
        const citation = citationById.get(citationId);
        return (
          <span key={citationId}>
            <LinkIcon aria-hidden size={13} />
            {citation?.title ?? citationId}
          </span>
        );
      })}
    </div>
  );
}

function TalkingPoints({ points }: { points: string[] }) {
  return (
    <section className="property-check-section">
      <h3>Agent talking points</h3>
      {points.length === 0 ? (
        <p className="property-check-muted">No agent talking points returned.</p>
      ) : (
        <ul className="property-check-bullet-list">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CitationList({ citations }: { citations: PropertyCitation[] }) {
  if (citations.length === 0) return null;

  return (
    <section className="property-check-section">
      <h3>Sources</h3>
      <div className="property-check-source-list">
        {citations.map((citation) => (
          <article className="property-check-source" key={citation.id}>
            <strong>{citation.title}</strong>
            <span>{formatLabel(citation.sourceType)}</span>
            {citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            ) : null}
            {citation.excerpt ? <p>{citation.excerpt}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function formatLabel(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
