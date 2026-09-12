"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/homepage-concept/content";
import { TRIAL_CTA_LABEL, TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import {
  REPORTS,
  formatAdSpend,
  lineChartGeometry,
  type ReportRange,
} from "@/lib/homepage-concept/reporting";
import { LeadEmailPreview } from "./lead-email-preview";
import "./demo-card.css";
import "./results-reporting.css";

type ReportingView = ReportRange | "email";
const REPORT_VIEWS: readonly ReportingView[] = ["week", "month", "email"];
const VIEW_LABELS: Record<ReportingView, string> = { week: "7 days", month: "30 days", email: "Email" };
/* One short line under the selector, matching the ad-creation card's header. */
const REPORT_BRIEFS: Record<ReportingView, string> = {
  week: "Your last 7 days",
  month: "Your last 30 days",
  email: "The update we send you",
};
const CHART_MAX: Record<ReportRange, number> = { week: 4, month: 12 };

/* Keep in step with --rr-draw in results-reporting.css. */
const DRAW_MS = 1400;
const HOLD_MS = 1200;
const EMAIL_HOLD_MS = 2200;
/** One pass through the views so people see the selector is theirs to drive. */
const VIEW_TOUR: readonly ReportingView[] = ["month", "email", "week"];

export function ResultsReporting() {
  const [view, setView] = useState<ReportingView>("week");
  const [range, setRange] = useState<ReportRange>("week");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const touchedRef = useRef(false);
  const gradientId = useId();
  const clipId = useId();
  const report = REPORTS[range];
  const chart = lineChartGeometry(report.points, CHART_MAX[range]);
  const activePoint = activeIndex === null ? null : chart.vertices[activeIndex];

  const chooseView = useCallback((next: ReportingView) => {
    setView(next);
    if (next !== "email") setRange(next);
    setActiveIndex(null);
  }, []);

  function selectView(next: ReportingView) {
    touchedRef.current = true;
    chooseView(next);
  }

  /* Arm once, the first time the chart scrolls into view. */
  useEffect(() => {
    const target = chartRef.current ?? sectionRef.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") {
      setArmed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setArmed(true);
        observer.disconnect();
      },
      { threshold: 0.4 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    let at = DRAW_MS + HOLD_MS;
    VIEW_TOUR.forEach((step) => {
      timers.push(
        window.setTimeout(() => {
          if (touchedRef.current) return;
          chooseView(step);
        }, at),
      );
      at += step === "email" ? EMAIL_HOLD_MS : DRAW_MS + HOLD_MS;
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [armed, chooseView]);

  /* Slide the pill to whichever view is showing. */
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const measure = () => {
      const active = tabs.querySelector<HTMLButtonElement>(`[data-view="${view}"]`);
      if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [view]);

  function inspectPoint(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.round(progress * (report.points.length - 1)));
  }

  return (
    <section
      ref={sectionRef}
      className={`rr-results${armed ? " is-armed" : ""}`}
      id="results"
      aria-labelledby="results-heading"
    >
      <div className="hc-shell rr-layout">
        <header className="rr-intro">
          <h2 id="results-heading">See your leads. Know your costs.</h2>
          <p>Track leads, cost per lead and Meta ad spend, then choose how often you want an email update.</p>
          <div className="rr-actions">
            <Button asChild size="lg" variant="outline" className="max-[760px]:w-full"><a href={TRIAL_SIGNUP_URL}>{TRIAL_CTA_LABEL}</a></Button>
          </div>
        </header>

        <div className="rr-stage hc-demo-card" aria-label="Interactive example report">
          <header className="rr-stage-topbar">
            <span className="rr-stage-brand"><i aria-hidden="true" /> Blockwise Reporting</span>

            <div className="rr-stage-slot">
              <div className="rr-views" ref={tabsRef} role="group" aria-label="Example report view">
                {indicator ? (
                  <span
                    className="rr-view-indicator"
                    style={{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }}
                    aria-hidden="true"
                  />
                ) : null}
                {REPORT_VIEWS.map((id) => (
                  <button type="button" key={id} data-view={id} aria-pressed={view === id} onClick={() => selectView(id)}>
                    {VIEW_LABELS[id]}
                  </button>
                ))}
              </div>
              <span className="rr-view-brief">{REPORT_BRIEFS[view]}</span>
            </div>
          </header>

          <div className="rr-panel" key={view}>
            {view !== "email" ? (
              <div className="rr-dashboard">
                <dl className="rr-metrics" aria-live="polite" aria-atomic="true">
                  <div><dt>Leads</dt><dd>{report.leads}</dd></div>
                  <div><dt>Cost per lead</dt><dd>{formatAdSpend(report.spend / report.leads)}</dd></div>
                  <div><dt>Meta ad spend</dt><dd>{formatAdSpend(report.spend)}</dd></div>
                </dl>

                <figure className="rr-chart" ref={chartRef}>
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
                          <clipPath id={clipId}>
                            <rect className="rr-chart-reveal" x="0" y="0" width="600" height="200" />
                          </clipPath>
                        </defs>
                        {[12, 100, 188].map((y) => <line key={y} x1="8" x2="592" y1={y} y2={y} className="rr-chart-guide" />)}
                        <g clipPath={`url(#${clipId})`}>
                          <path className="rr-chart-area" d={chart.area} fill={`url(#${gradientId})`} aria-hidden="true" />
                          <path className="rr-chart-line" d={chart.line} aria-hidden="true" />
                        </g>
                        {chart.vertices.map((point, index) => (
                          <circle
                            key={report.labels[index]}
                            className="rr-chart-point"
                            cx={point.x}
                            cy={point.y}
                            r="3"
                            style={{ "--i": index / Math.max(1, report.points.length - 1) } as CSSProperties}
                            aria-hidden="true"
                          />
                        ))}
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
              </div>
            ) : (
              <LeadEmailPreview />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
