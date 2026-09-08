"use client";

import { ArrowRight } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useInView } from "motion/react";
import { useId, useRef, useState } from "react";
import {
  REPORTS,
  formatAdSpend,
  lineChartGeometry,
  type ReportRange,
} from "@/lib/homepage-concept/reporting";
import { durations, reportingReveal, useReducedMotion } from "@/lib/motion";

const REPORT_RANGES: readonly ReportRange[] = ["week", "month"];
const CHART_MAX: Record<ReportRange, number> = { week: 4, month: 12 };
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** A product-shaped proof: live results, then the update cadence that carries them to you. */
export function ResultsReporting() {
  const [range, setRange] = useState<ReportRange>("week");
  const [instant, setInstant] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const chartRef = useRef<HTMLDivElement>(null);
  const inView = useInView(chartRef, { once: false, amount: 0.4 });
  const gradientId = useId();
  const revealId = useId();
  const report = REPORTS[range];
  const chart = lineChartGeometry(report.points, CHART_MAX[range]);
  const activePoint = activeIndex === null ? null : chart.vertices[activeIndex];
  const chartTransition = {
    duration: reducedMotion || instant ? 0 : durations.entrance,
    ease: EASE_OUT,
  };

  function inspectPoint(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(progress * (report.points.length - 1)));
  }

  return (
    <section className="hc-results" id="results" aria-labelledby="results-heading">
      <div className="hc-shell hc-results-layout">
        <header className="hc-results-intro">
          <h2 id="results-heading">See your leads. Know your costs.</h2>
          <p>Track your leads, cost per lead and ad spend in one simple dashboard. Get email updates as often or as little as you like.</p>
          <div className="hc-results-actions">
            <a className="hc-button hc-button--primary" href="#trial">Start free trial<ArrowRight size={17} aria-hidden="true" /></a>
            <span>No card required.</span>
          </div>
        </header>

        <div className="hc-reporting-stage" aria-label="Example personal ad dashboard">
          <div className="hc-reporting-topline">
            <div>
              <span className="hc-live-dot" aria-hidden="true" />
              <strong>Mt Lawley appraisal</strong>
            </div>
            <LayoutGroup id="report-range">
              <div className="hc-report-range" role="group" aria-label="Dashboard reporting period">
                {REPORT_RANGES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={REPORTS[id].label}
                    aria-pressed={range === id}
                    onClick={(event) => {
                      setInstant(event.detail === 0);
                      setRange(id);
                      setActiveIndex(null);
                    }}
                  >
                    {range === id ? <motion.span className="hc-range-active" layoutId="active-range" transition={chartTransition} /> : null}
                    <span>{id === "week" ? "7 days" : "30 days"}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          </div>

          <div className="hc-report-overview">
            <dl className="hc-report-metrics" aria-live="polite" aria-atomic="true">
              <div><dt>Leads generated</dt><dd>{report.leads}</dd></div>
              <div><dt>Cost per lead</dt><dd>{formatAdSpend(report.spend / report.leads)}</dd></div>
              <div><dt>Ad spend</dt><dd>{formatAdSpend(report.spend)}</dd></div>
            </dl>
            <aside className="hc-email-update" aria-label="Example performance email update">
              <span>In your inbox</span>
              <strong>Performance update</strong>
              <p>{report.leads} leads at {formatAdSpend(report.spend / report.leads)} per lead</p>
            </aside>
          </div>

          <figure className="hc-leads-chart">
            <figcaption className="hc-report-sr-only">Leads over time</figcaption>
            <div className="hc-line-chart-grid">
              <div className="hc-chart-scale" aria-hidden="true">
                <span>{CHART_MAX[range]}</span><span>{CHART_MAX[range] / 2}</span><span>0</span>
              </div>
              <div className="hc-chart-plot" ref={chartRef}>
                <svg
                  className="hc-line-chart"
                  viewBox="0 0 600 200"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${report.label}: ${report.labels.map((label, index) => `${label}, ${report.points[index]} leads`).join("; ")}`}
                  onPointerMove={inspectPoint}
                  onPointerLeave={() => setActiveIndex(null)}
                >
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4e9cf5" stopOpacity=".28" />
                      <stop offset="100%" stopColor="#4e9cf5" stopOpacity="0" />
                    </linearGradient>
                    <clipPath id={revealId}>
                      <motion.rect
                        key={range}
                        className="hc-chart-reveal"
                        x="-4" y="-12" height="224"
                        initial={reducedMotion ? false : { width: 0 }}
                        animate={{ width: reducedMotion || inView ? 608 : 0 }}
                        transition={{ duration: reducedMotion || !inView ? 0 : reportingReveal.duration, ease: reportingReveal.ease }}
                      />
                    </clipPath>
                  </defs>
                  {[12, 100, 188].map((y) => <line key={y} x1="8" x2="592" y1={y} y2={y} className="hc-chart-guide" />)}
                  <g clipPath={`url(#${revealId})`}>
                  <motion.path
                    className="hc-chart-area"
                    fill={`url(#${gradientId})`}
                    initial={false}
                    animate={{ d: chart.area }}
                    transition={chartTransition}
                    aria-hidden="true"
                  />
                  <motion.path
                    className="hc-chart-line"
                    initial={false}
                    animate={{ d: chart.line }}
                    transition={chartTransition}
                    aria-hidden="true"
                  />
                  </g>
                  <rect className="hc-chart-hitarea" x="0" y="0" width="600" height="200" aria-hidden="true" />
                </svg>

                <AnimatePresence>
                  {activePoint ? (
                    <>
                      <motion.span
                        className="hc-chart-cursor"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, left: `${activePoint.x / 6}%` }}
                        style={{ "--point-y": `${activePoint.y / 2}%` } as React.CSSProperties}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : durations.micro, ease: EASE_OUT }}
                        aria-hidden="true"
                      />
                      <motion.div
                        className="hc-chart-tooltip"
                        initial={{ opacity: 0 }}
                        animate={{
                          opacity: 1,
                          left: `${Math.min(86, Math.max(14, activePoint.x / 6))}%`,
                          top: `${activePoint.y / 2}%`,
                        }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : durations.micro, ease: EASE_OUT }}
                      >
                        <strong>{report.points[activeIndex ?? 0]} leads</strong>
                        <span>{report.labels[activeIndex ?? 0]}</span>
                      </motion.div>
                    </>
                  ) : null}
                </AnimatePresence>

              </div>
              <div className={`hc-chart-dates hc-chart-dates--${range}`} aria-hidden="true">
                {report.labels.map((label, index) => (
                  <span
                    key={label}
                    style={{
                      "--label-position": `${index / Math.max(1, report.labels.length - 1) * 100}%`,
                    } as React.CSSProperties}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </figure>

        </div>

      </div>
    </section>
  );
}
