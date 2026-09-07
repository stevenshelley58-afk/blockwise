"use client";

import { ArrowRight, Check, Clock3, Mail } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { EMAIL_CADENCES, REPORTS, exampleEmail, formatAdSpend, type EmailCadence, type ReportRange } from "@/lib/homepage-concept/reporting";
import { durations, useReducedMotion } from "@/lib/motion";

/** Results-only persuasion: visibility without agency dependence; not another how-to. */
export function ResultsReporting() {
  const [range, setRange] = useState<ReportRange>("week");
  const [cadence, setCadence] = useState<EmailCadence>("weekly");
  const [customDays, setCustomDays] = useState(3);
  const [instant, setInstant] = useState(true);
  const reducedMotion = useReducedMotion();
  const report = REPORTS[range];
  const email = exampleEmail(cadence, customDays);
  const transition = { duration: reducedMotion || instant ? 0 : durations.state, ease: [0.22, 1, 0.36, 1] as const };
  const chartMax = range === "week" ? 5 : 25;

  return (
    <section className="hc-results" id="results" aria-labelledby="results-heading">
      <div className="hc-shell">
        <div className="hc-results-intro">
          <h2 id="results-heading">No guesswork.<br /><span>No chasing updates.</span></h2>
          <div className="hc-results-value">
            <p>Know how your ads are going without waiting for an agency report. Your own dashboard. Clear email updates. On your schedule.</p>
            <div><a className="hc-button hc-button--primary" href="#trial">Start free trial <ArrowRight aria-hidden="true" size={17} /></a><span>No card required.</span></div>
          </div>
        </div>
        <div className="hc-reporting-story">
          <div className="hc-dashboard-story">
            <div className="hc-reporting-caption"><h3>Your performance, at a glance.</h3><p>See the leads coming in, what you’re spending and what each lead costs.</p></div>
            <div className="hc-personal-dashboard" aria-label="Example personal ad dashboard">
              <div className="hc-reporting-topbar"><span className="hc-dashboard-brand">blockwise<span aria-hidden="true">.</span></span><span>Example data</span></div>
              <div className="hc-dashboard-body">
                <div className="hc-dashboard-title">
                  <h4>Your ad overview</h4>
                  <div className="hc-report-range" role="group" aria-label="Dashboard reporting period">
                    {(["week", "month"] as const).map((id) => <button key={id} type="button" aria-pressed={range === id} onClick={(event) => { setInstant(event.detail === 0); setRange(id); }}>{REPORTS[id].label}</button>)}
                  </div>
                </div>
                <dl className="hc-report-metrics" aria-live="polite" aria-atomic="true">
                  <div><dt>Leads received</dt><dd>{report.leads}</dd></div><div><dt>Ad spend</dt><dd>{formatAdSpend(report.spend)}</dd></div><div><dt>Cost per lead</dt><dd>{formatAdSpend(report.spend / report.leads)}</dd></div>
                </dl>
                <figure className="hc-leads-chart">
                  <figcaption><strong>Leads over time</strong><span>{report.label}</span></figcaption>
                  <div className="hc-chart-plot" role="img" aria-label={`${report.label}: ${report.labels.map((label, index) => `${label}, ${report.points[index]} leads`).join("; ")}`}>
                    <div className="hc-chart-scale" aria-hidden="true"><span>{chartMax}</span><span>{chartMax / 2}</span><span>0</span></div>
                    <div className="hc-chart-bars" aria-hidden="true">
                      {report.points.map((value, index) => <div className="hc-chart-column" key={index}>
                        <div className="hc-chart-track"><motion.div className="hc-chart-fill" initial={false} animate={{ transform: `scaleY(${value / chartMax})` }} transition={transition} /><span className="hc-chart-value" style={{ bottom: `${value / chartMax * 100}%` }}>{value}</span></div>
                        <span className="hc-chart-label">{report.labels[index]}</span>
                      </div>)}
                    </div>
                  </div>
                </figure>
                <table className="hc-campaign-report">
                  <caption className="hc-report-sr-only">Campaign performance, {report.label.toLowerCase()}</caption>
                  <thead><tr><th scope="col">Campaign</th><th scope="col">Leads</th><th scope="col">Spend</th></tr></thead>
                  <tbody>{report.campaigns.map((campaign) => <tr key={campaign.name}><th scope="row"><span className="hc-campaign-status" aria-label="Active" />{campaign.name}</th><td>{campaign.leads}</td><td>{formatAdSpend(campaign.spend)}</td></tr>)}</tbody>
                </table>
                <div className="hc-dashboard-footnote"><span><Check aria-hidden="true" size={14} /> Your numbers. In one place.</span><span>All amounts AUD</span></div>
              </div>
            </div>
          </div>
          <div className="hc-inbox-story">
            <div className="hc-reporting-caption"><h3>Or just check your inbox.</h3><p>Get the summary without logging in. Choose how often it lands.</p></div>
            <div className="hc-email-delivery">
              <div className="hc-email-schedule" aria-live="polite" aria-atomic="true"><Clock3 aria-hidden="true" size={16} /><span>{email.schedule}</span></div>
              <div className="hc-report-email">
                <div className="hc-email-sender"><Mail aria-hidden="true" size={21} /><div><strong>Blockwise</strong><span>Your ad performance update</span></div></div>
                <motion.div className="hc-email-content" key={`${cadence}-${customDays}`} initial={reducedMotion || instant ? false : { opacity: 0.4, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} transition={transition}>
                  <h4>{email.subject}</h4><p>Here’s how your ads are going.</p><span className="hc-email-period">{email.period}</span>
                  <dl className="hc-email-metrics"><div><dt>New leads</dt><dd>{email.leads}</dd></div><div><dt>Ad spend</dt><dd>{formatAdSpend(email.spend)}</dd></div><div><dt>Cost per lead</dt><dd>{formatAdSpend(email.spend / email.leads)}</dd></div></dl>
                  <p className="hc-email-signoff">The numbers you need.<br />No follow-up email required.</p>
                </motion.div>
              </div>
              <fieldset className="hc-email-frequency" onKeyDown={() => setInstant(true)} onPointerDown={() => setInstant(false)}>
                <legend>How often would you like an update?</legend>
                <div className="hc-cadence-options">{EMAIL_CADENCES.map((option) => <label key={option.id}><input type="radio" name="example-email-frequency" value={option.id} checked={cadence === option.id} onChange={() => setCadence(option.id)} /><span>{option.label}</span></label>)}</div>
                {cadence === "custom" && <label className="hc-custom-cadence">Every<select aria-label="Days between example email updates" value={customDays} onChange={(event) => setCustomDays(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days}</option>)}</select>days</label>}
              </fieldset>
              <p className="hc-email-preview-note">Try the example schedule. Nothing is saved or sent.</p>
            </div>
          </div>
        </div>
        <p className="hc-reporting-close">Less time chasing answers. <strong>More time following up leads.</strong></p>
      </div>
    </section>
  );
}
