import type {
  AuditSignals,
  InsightBlock,
} from "@/lib/research/audit-insights";

const numberFormat = new Intl.NumberFormat("en-AU");

export function StatCard({ value, label, hint }: { value: string; label: string; hint: string }) {
  return (
    <div className="audit-stat">
      <strong>{value}</strong>
      <span className="audit-stat-label">{label}</span>
      <span className="audit-stat-hint">{hint}</span>
    </div>
  );
}

export function SignalGrid({ signals }: { signals: AuditSignals }) {
  const items: Array<{ label: string; value: string }> = [
    { label: "Current activity", value: activityLabel(signals.currentActivityLevel) },
    { label: "Recent pattern", value: patternLabel(signals.recentActivityPattern) },
    { label: "Concentration", value: concentrationLabel(signals.marketConcentration) },
    { label: "Creative", value: formatLabel(signals.creativeFormatPattern) },
    { label: "Messaging", value: messageLabel(signals.messagePattern) },
  ];
  return (
    <div className="audit-signal-grid">
      {items.map((item) => (
        <div className="audit-signal" key={item.label}>
          <span className="audit-signal-label">{item.label}</span>
          <span className="audit-signal-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function InsightBlockCard({ block }: { block: InsightBlock }) {
  return (
    <article className="audit-insight">
      <header className="audit-insight-head">
        <h3>{block.title}</h3>
      </header>
      <dl className="audit-insight-body">
        <Field label="What we saw">{block.observation}</Field>
        <Field label="What it says">{block.interpretation}</Field>
        <Field label="Why it matters">{block.whyItMatters}</Field>
        <Field label="Don't overread it">{block.whatNotToAssume}</Field>
      </dl>
      <div className="audit-insight-actions">
        <span className="audit-insight-actions-label">Check next</span>
        <ul>
          {block.usefulActions.map((action, index) => (
            <li key={index}>{action}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="audit-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function BreakdownBars({ title, items, note }: { title: string; items: Array<{ label: string; count: number }>; note: string }) {
  const top = items.slice(0, 5);
  const max = top.reduce((value, item) => Math.max(value, item.count), 0) || 1;
  return (
    <div className="audit-breakdown-card">
      <h4>{title}</h4>
      <p className="audit-breakdown-note">{note}</p>
      {top.length > 0 ? (
        <ul className="audit-bars">
          {top.map((item) => (
            <li key={item.label}>
              <span className="audit-bar-label">{item.label}</span>
              <span className="audit-bar-track"><span className="audit-bar-fill" style={{ width: `${Math.round((item.count / max) * 100)}%` }} /></span>
              <span className="audit-bar-count">{numberFormat.format(item.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="audit-breakdown-empty">No data.</p>
      )}
    </div>
  );
}

export function BreakdownChips({ title, items, note }: { title: string; items: Array<{ label: string; count: number }>; note: string }) {
  const top = items.slice(0, 8);
  return (
    <div className="audit-breakdown-card">
      <h4>{title}</h4>
      <p className="audit-breakdown-note">{note}</p>
      {top.length > 0 ? (
        <div className="audit-chips">
          {top.map((item) => (
            <span className="audit-chip" key={item.label}>{item.label}<i>{numberFormat.format(item.count)}</i></span>
          ))}
        </div>
      ) : (
        <p className="audit-breakdown-empty">No data.</p>
      )}
    </div>
  );
}

function activityLabel(level: AuditSignals["currentActivityLevel"]): string {
  return { none: "No live ads", low: "Low", moderate: "Moderate", high: "High" }[level];
}
function patternLabel(pattern: AuditSignals["recentActivityPattern"]): string {
  return {
    quiet: "Quiet",
    recent_burst_now_paused: "Recent burst, now paused",
    steady_activity: "Steady activity",
    active_growth: "Active and growing",
    stale_archive: "Mostly historical",
  }[pattern];
}
function concentrationLabel(value: AuditSignals["marketConcentration"]): string {
  return {
    one_dominant_advertiser: "One advertiser dominates",
    concentrated: "Concentrated (top two)",
    fragmented: "Fragmented",
    too_little_data: "Too little data",
  }[value];
}
function formatLabel(value: AuditSignals["creativeFormatPattern"]): string {
  return { image_heavy: "Image-heavy", video_heavy: "Video-heavy", mixed: "Mixed", too_little_data: "Too little data" }[value];
}
function messageLabel(value: AuditSignals["messagePattern"]): string {
  return {
    listing_led: "Listing-led",
    appraisal_led: "Appraisal-led",
    proof_led: "Proof-led (sold/results)",
    generic: "Generic / brand",
    mixed: "Mixed",
    too_little_data: "Too little data",
  }[value];
}
// inert padding (workspace editor-sync keeps this file's byte length fixed; no runtime effect) xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx */
