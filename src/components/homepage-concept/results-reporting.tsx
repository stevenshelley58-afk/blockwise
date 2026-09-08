"use client";

import { ArrowRight, Mail, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { TRIAL_CTA_LABEL, TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import {
  REPORTS,
  REPORT_EXAMPLE,
  formatAdSpend,
  lineChartGeometry,
  type ReportRange,
} from "@/lib/homepage-concept/reporting";
import {
  REPORT_EMAIL,
  REPORT_EMAIL_FREQUENCIES,
  type ReportEmailFrequency,
} from "@/lib/homepage-concept/reporting-email";
import "./results-reporting.css";

type ReportingView = ReportRange | "email";
const REPORT_VIEWS: readonly ReportingView[] = ["week", "month", "email"];
const CHART_MAX: Record<ReportRange, number> = { week: 4, month: 12 };

export function ResultsReporting() {
  const [view, setView] = useState<ReportingView>("week");
  const [range, setRange] = useState<ReportRange>("week");
  const [frequency, setFrequency] = useState<ReportEmailFrequency>("weekly");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId();
  const report = REPORTS[range];
  const chart = lineChartGeometry(report.points, CHART_MAX[range]);
  const activePoint = activeIndex === null ? null : chart.vertices[activeIndex];

  function chooseView(next: ReportingView) {
    setView(next);
    if (next !== "email") setRange(next);
    setActiveIndex(null);
  }

  function inspectPoint(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(progress * (report.points.length - 1)));
  }

  return (
    <section className="rr-results" id="results" aria-labelledby="results-heading">
      <div className="hc-shell rr-layout">
        <header className="rr-intro">
          <h2 id="results-heading">See your leads. Know your costs.</h2>
          <p>Track leads, cost per lead and Meta ad spend, then choose how often you want an email update.</p>
          <div className="rr-actions">
            <a className="hc-button hc-button--primary" href={TRIAL_SIGNUP_URL}>{TRIAL_CTA_LABEL}<ArrowRight size={17} aria-hidden="true" /></a>
          </div>
        </header>

        <div className="rr-stage" aria-label="Interactive example report">
          <header className="rr-stage-head">
            <div className="rr-campaign">
              <span>Example report</span>
              <strong>{REPORT_EXAMPLE.campaign}</strong>
              <small>{REPORT_EXAMPLE.agency} · {REPORT_EXAMPLE.status}</small>
            </div>
            <label className="rr-frequency">
              <span>Email updates</span>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as ReportEmailFrequency)}>
                {REPORT_EMAIL_FREQUENCIES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </header>

          <div className="rr-tabs" role="group" aria-label="Example report view">
            {REPORT_VIEWS.map((id) => (
              <button type="button" key={id} aria-pressed={view === id} onClick={() => chooseView(id)}>
                {id === "week" ? "7 days" : id === "month" ? "30 days" : "Email"}
              </button>
            ))}
          </div>

          {view !== "email" ? (
            <div className="rr-dashboard">
              <dl className="rr-metrics" aria-live="polite" aria-atomic="true">
                <div><dt>Leads</dt><dd>{report.leads}</dd></div>
                <div><dt>Cost per lead</dt><dd>{formatAdSpend(report.spend / report.leads)}</dd></div>
                <div><dt>Meta ad spend</dt><dd>{formatAdSpend(report.spend)}</dd></div>
              </dl>

              <figure className="rr-chart">
                <figcaption>{report.label}. Example leads by day.</figcaption>
                <div className="rr-chart-grid">
                  <div className="rr-chart-scale" aria-hidden="true"><span>{CHART_MAX[range]}</span><span>{CHART_MAX[range] / 2}</span><span>0</span></div>
                <div className="rr-chart-plot">
                  <svg
                    viewBox="0 0 600 200"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${report.label}: ${report.labels.map((label, index) => `${label}, ${report.points[index]} leads`).join("; ")}`}
                    onPointerMove={inspectPoint}
                    onPointerLeave={() => setActiveIndex(null)}
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--hc-blue-bright)" stopOpacity=".24" />
                        <stop offset="100%" stopColor="var(--hc-blue-bright)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[12, 100, 188].map((y) => <line key={y} x1="8" x2="592" y1={y} y2={y} className="rr-chart-guide" />)}
                    <path className="rr-chart-area" d={chart.area} fill={`url(#${gradientId})`} aria-hidden="true" />
                    <path className="rr-chart-line" d={chart.line} aria-hidden="true" />
                    {chart.vertices.map((point, index) => <circle key={report.labels[index]} className="rr-chart-point" cx={point.x} cy={point.y} r="3" aria-hidden="true" />)}
                    <rect className="rr-chart-hitarea" x="0" y="0" width="600" height="200" aria-hidden="true" />
                  </svg>
                  {activePoint ? (
                    <div className="rr-chart-tooltip" style={{ left: `${Math.min(88, Math.max(12, activePoint.x / 6))}%`, top: `${activePoint.y / 2}%` }}>
                      <strong>{report.points[activeIndex ?? 0]} leads</strong>
                      <span>{report.labels[activeIndex ?? 0]}</span>
                    </div>
                  ) : null}
                </div>
                </div>
                <div className="rr-chart-labels" aria-hidden="true">{report.labels.map((label) => <span key={label}>{label}</span>)}</div>
              </figure>

              <div className="rr-lead-flow" aria-label="Example path from ad to manual follow-up">
                <span className="rr-flow-node">Example ad</span>
                <ArrowRight size={17} aria-hidden="true" />
                <article className="rr-lead-card" aria-label="Example lead from the Free property appraisal campaign">
                  <UserRound size={18} aria-hidden="true" />
                  <div><strong>{REPORT_EXAMPLE.lead.name}</strong><span>{REPORT_EXAMPLE.lead.email} · {REPORT_EXAMPLE.lead.phone}</span><small>{REPORT_EXAMPLE.lead.suburb} · {REPORT_EXAMPLE.lead.received}</small></div>
                </article>
                <ArrowRight size={17} aria-hidden="true" />
                <span className="rr-flow-node">You follow up</span>
              </div>
              <p className="rr-safety-note">Example lead with fictional contact details. Blockwise does not contact the lead for you.</p>
            </div>
          ) : (
            <article className="rr-email" aria-labelledby="rr-email-subject">
              <header><Mail size={18} aria-hidden="true" /><span>Illustrative email preview</span><small>Frequency: {REPORT_EMAIL_FREQUENCIES.find((option) => option.id === frequency)?.label}</small></header>
              <div className="rr-email-body">
                <span>{report.label}</span>
                <h3 id="rr-email-subject">{REPORT_EMAIL.subject}</h3>
                <p>{REPORT_EMAIL.intro}</p>
                <dl>{REPORT_EMAIL.metricLabels.map((label, index) => <div key={label}><dt>{label}</dt><dd>{index === 0 ? report.leads : index === 1 ? formatAdSpend(report.spend / report.leads) : formatAdSpend(report.spend)}</dd></div>)}</dl>
                <p>{REPORT_EMAIL.footer}</p>
                <button type="button" onClick={() => chooseView("week")}>View example report</button>
              </div>
            </article>
          )}

          <p className="rr-disclosure">Illustrative campaign, lead and reporting data. Nothing is fetched, saved or emailed.</p>
        </div>
      </div>
    </section>
  );
}
