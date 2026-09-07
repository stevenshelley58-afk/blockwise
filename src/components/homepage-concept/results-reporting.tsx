"use client";

import { ArrowRight, Mail } from "lucide-react";
import { motion } from "motion/react";
import { useId, useState } from "react";
import {
  EMAIL_CADENCES, REPORTS, emailSchedule, formatAdSpend, lineChartGeometry,
  type EmailCadence, type ReportRange,
} from "@/lib/homepage-concept/reporting";
import { durations, useReducedMotion } from "@/lib/motion";

/** One dashboard, one email control. The visual does the explaining. */
export function ResultsReporting() {
  const [range, setRange] = useState<ReportRange>("week");
  const [cadence, setCadence] = useState<EmailCadence>("weekly");
  const [customDays, setCustomDays] = useState(3);
  const [instant, setInstant] = useState(true);
  const reducedMotion = useReducedMotion();
  const gradientId = useId();
  const report = REPORTS[range];
  const schedule = emailSchedule(cadence, customDays);
  const chartMax = range === "week" ? 4 : 24;
  const chart = lineChartGeometry(report.points, chartMax);

  return (
    <section className="hc-results" id="results" aria-labelledby="results-heading">
      <div className="hc-shell hc-results-layout">
        <div className="hc-results-copy">
          <h2 id="results-heading">No more<br />chasing updates.</h2>
          <p>Your dashboard.<br />Emails on your schedule.</p>
          <a className="hc-button hc-button--primary" href="#trial">
            Start free trial <ArrowRight aria-hidden="true" size={17} />
          </a>
          <span>No card required.</span>
        </div>

        <div className="hc-reporting-visual">
          <div className="hc-personal-dashboard" aria-label="Example personal ad dashboard">
            <div className="hc-dashboard-title">
              <h3>Your dashboard</h3>
              <div className="hc-report-range" role="group" aria-label="Dashboard reporting period">
                {(["week", "month"] as const).map((id) => (
                  <button key={id} type="button" aria-label={REPORTS[id].label}
                    aria-pressed={range === id}
                    onClick={(event) => { setInstant(event.detail === 0); setRange(id); }}>
                    {id === "week" ? "7 days" : "30 days"}
                  </button>
                ))}
              </div>
            </div>
            <div className="hc-dashboard-body">
              <dl className="hc-report-metrics" aria-live="polite" aria-atomic="true">
                <div><dt>Leads</dt><dd>{report.leads}</dd></div>
                <div><dt>Spend</dt><dd>{formatAdSpend(report.spend)}</dd></div>
                <div><dt>Per lead</dt><dd>{formatAdSpend(report.spend / report.leads)}</dd></div>
              </dl>
              <figure className="hc-leads-chart">
                <figcaption className="hc-report-sr-only">Leads over time</figcaption>
                <div className="hc-line-chart-grid">
                  <div className="hc-chart-scale" aria-hidden="true"><span>{chartMax}</span><span>{chartMax / 2}</span><span>0</span></div>
                  <svg className="hc-line-chart" viewBox="0 0 600 200" preserveAspectRatio="none" role="img"
                    aria-label={`${report.label}: ${report.labels.map((label, index) => `${label}, ${report.points[index]} leads`).join("; ")}`}>
                    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2a78d6" stopOpacity=".13" /><stop offset="100%" stopColor="#2a78d6" stopOpacity="0" /></linearGradient></defs>
                    {[12, 100, 188].map((y) => <line key={y} x1="8" x2="592" y1={y} y2={y} className="hc-chart-guide" />)}
                    <path d={chart.area} fill={`url(#${gradientId})`} aria-hidden="true" />
                    <motion.path key={range} className="hc-chart-line" d={chart.line}
                      initial={reducedMotion || instant ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: reducedMotion || instant ? 0 : durations.state, ease: [0.22, 1, 0.36, 1] }} />
                  </svg>
                  <div className="hc-chart-dates" aria-hidden="true"><span>{report.labels[0]}</span><span>{report.labels[report.labels.length - 1]}</span></div>
                </div>
              </figure>
            </div>

            <div className="hc-email-controls" onKeyDown={() => setInstant(true)} onPointerDown={() => setInstant(false)}>
              <Mail aria-hidden="true" size={23} />
              <div className="hc-email-control-copy">
                <label htmlFor="reporting-email-cadence">Email updates</label>
                <span aria-live="polite">{schedule}</span>
              </div>
              <select id="reporting-email-cadence" value={cadence}
                onChange={(event) => setCadence(event.target.value as EmailCadence)}>
                {EMAIL_CADENCES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              {cadence === "custom" && <label className="hc-custom-cadence">Every
                <select aria-label="Days between example email updates" value={customDays}
                  onChange={(event) => setCustomDays(Number(event.target.value))}>
                  {Array.from({ length: 30 }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days}</option>)}
                </select>days
              </label>}
            </div>
          </div>
          <p className="hc-reporting-disclosure">Example data · AUD · Nothing sent or saved.</p>
        </div>
      </div>
    </section>
  );
}
