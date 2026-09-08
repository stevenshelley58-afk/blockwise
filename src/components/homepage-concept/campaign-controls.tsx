"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowUpRight, Check, Mail, Pause, Play, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { durations } from "@/lib/motion";
import { withBasePath } from "@/lib/homepage-concept/content";

const controls = [
  { id: "creative", label: "Creative control", detail: "Make it yours." },
  { id: "budget", label: "Budget control", detail: "Set your own limits." },
  { id: "campaign", label: "Campaign detail", detail: "Know where things stand." },
  { id: "updates", label: "Helpful updates", detail: "On your terms." },
] as const;

export function CampaignControls() {
  const [active, setActive] = useState(0);
  const [headline, setHeadline] = useState("A new perspective");
  const [budget, setBudget] = useState(30);
  const [days, setDays] = useState(7);
  const [paused, setPaused] = useState(false);
  const [frequency, setFrequency] = useState("Weekly");
  const reduced = useReducedMotion();

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? 3 : event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index + 3) % 4 : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    document.getElementById(`control-tab-${controls[next].id}`)?.focus();
  }

  return (
    <section className="hc-control" id="control" aria-labelledby="control-heading">
      <div className="hc-shell hc-control-grid">
        <div className="hc-control-copy">
          <h2 id="control-heading">You’re in <br />control.</h2>
          <div className="hc-control-tabs" role="tablist" aria-label="Explore campaign controls" aria-orientation="vertical">
            {controls.map((item, index) => (
              <button key={item.id} type="button" role="tab" id={`control-tab-${item.id}`} aria-controls={`control-panel-${item.id}`} aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => onTabKey(event, index)}>
                <span className="hc-control-number" aria-hidden="true">0{index + 1}</span>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <ArrowUpRight size={20} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className="hc-control-demo">
          <header className="hc-control-bar"><span><span className="hc-control-mark" aria-hidden="true">B</span>Campaign controls</span><span className="hc-control-preview">Preview</span></header>
          <div className="hc-control-panels">
            {controls.map((item, index) => (
              <motion.div key={item.id} className="hc-control-panel" role="tabpanel" id={`control-panel-${item.id}`} aria-labelledby={`control-tab-${item.id}`} aria-hidden={active !== index} inert={active !== index} initial={false} animate={{ opacity: active === index ? 1 : 0, y: reduced || active === index ? 0 : 6 }} transition={{duration: reduced ? 0 : durations.state}} style={{gridArea: "1 / 1", pointerEvents:active === index ? "auto" : "none"}}>
                {item.id === "creative" && <>
                  <div className="hc-control-panel-title"><h3>Your brand. Your final say.</h3><ShieldCheck size={22} aria-hidden="true" /></div>
                  <div className="hc-control-creative">
                    <figure className="hc-control-ad"><img src={withBasePath("/home/home-dusk.webp")} alt="Contemporary home at dusk" width="520" height="520" /><figcaption><span>WEST COAST HOME CO</span><strong>{headline || "Your headline"}</strong><small>Discover your home’s value</small></figcaption></figure>
                    <div className="hc-control-edit"><label htmlFor="control-headline">Ad headline</label><input id="control-headline" value={headline} maxLength={40} onChange={(event) => setHeadline(event.target.value)} /><div className="hc-control-check"><Check size={16} aria-hidden="true" /> Your photos</div><div className="hc-control-check"><Check size={16} aria-hidden="true" /> Your branding</div><div className="hc-control-approval"><ShieldCheck size={18} aria-hidden="true" /> You approve before launch.</div></div>
                  </div>
                </>}
                {item.id === "budget" && <>
                  <div className="hc-control-panel-title"><h3>A budget you’re happy with.</h3></div>
                  <label className="hc-control-budget-label" htmlFor="control-budget">Daily ad budget</label>
                  <div className="hc-control-amount"><output htmlFor="control-budget">${budget}</output><span>AUD / day</span></div>
                  <input className="hc-control-range" id="control-budget" type="range" min="10" max="100" step="5" value={budget} onChange={(event) => setBudget(Number(event.target.value))} style={{"--range-fill": `${(budget - 10) / 90 * 100}%`} as CSSProperties} />
                  <div className="hc-control-range-ends"><span>$10</span><span>$100</span></div>
                  <div className="hc-control-choice" role="group" aria-label="Example campaign duration">{[7,14,30].map(value => <button type="button" key={value} aria-pressed={days === value} onClick={()=>setDays(value)}>{value} days</button>)}</div>
                  <div className="hc-control-total"><span>Planned ad spend</span><strong>${(budget * days).toLocaleString("en-AU")} AUD</strong></div>
                  <p className="hc-control-note">Ad spend is separate, paid directly to Meta.</p>
                </>}
                {item.id === "campaign" && <>
                  <div className="hc-control-panel-title"><h3>Nothing left in the dark.</h3></div>
                  <div className="hc-control-campaign-name"><span>Mt Lawley appraisal</span><span className={`hc-control-status ${paused ? "is-paused" : ""}`}><i />{paused ? "Paused" : "Active"}</span></div>
                  <dl className="hc-control-metrics"><div><dt>Leads</dt><dd>18</dd></div><div><dt>Cost per lead</dt><dd>$18</dd></div><div><dt>Ad spend</dt><dd>$324</dd></div></dl>
                  <div className="hc-control-ledger"><span><Check size={17} />Creative approved</span><span><Check size={17} />Budget confirmed</span><span>{paused ? <Pause size={17} /> : <Play size={17} />}{paused ? "Campaign paused" : "Campaign running"}</span></div>
                  <button className="hc-control-action" type="button" onClick={()=>setPaused(!paused)}>{paused ? <Play size={16} /> : <Pause size={16} />}{paused ? "Resume example campaign" : "Pause example campaign"}</button>
                </>}
                {item.id === "updates" && <>
                  <div className="hc-control-panel-title"><h3>Stay informed. Not interrupted.</h3><Mail size={22} aria-hidden="true" /></div>
                  <div className="hc-control-email"><span className="hc-control-email-from">Blockwise <span>To you</span></span><strong>Your week in ads</strong><p>18 new leads. $18 per lead.</p><div className="hc-control-email-rule" /><span>Your results, without logging in.</span></div>
                  <p className="hc-control-frequency-label">Email frequency</p>
                  <div className="hc-control-choice hc-control-frequency" role="group" aria-label="Example email frequency">{["Daily","Weekly","Monthly","Never"].map(value=><button type="button" key={value} aria-pressed={frequency === value} onClick={()=>setFrequency(value)}>{value}</button>)}</div>
                  <p className="hc-control-note" role="status">{frequency === "Never" ? "Emails off. Your dashboard is always there." : `${frequency} updates selected.`}</p>
                </>}
              </motion.div>
            ))}
          </div>
          <footer className="hc-control-demo-footer">Interactive preview. Changes stay here.</footer>
        </div>
      </div>
    </section>
  );
}
