"use client";

import { ArrowRight, Check, MoreHorizontal, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/homepage-concept/content";
import { TRIAL_CTA_LABEL, TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import {
  WORKFLOW_AD as AD, WORKFLOW_PHASES, WORKFLOW_STEPS, WORKFLOW_STEP_STARTS,
  WORKFLOW_TEMPLATES, nextWorkflowPhase, workflowFrame,
} from "@/lib/homepage-concept/workflow";
import "./workflow-showcase.css";

type Frame = ReturnType<typeof workflowFrame>;

/** One text node changes in place. Its line box never changes size. */
function useTypedText(before: string, after: string, editing: boolean, edited: boolean, reduced: boolean) {
  const [text, setText] = useState(before);
  useEffect(() => {
    if (!editing || reduced) { setText(edited ? after : before); return; }
    setText(before);
    let timer: ReturnType<typeof setTimeout>;
    let position = 0;
    const type = () => {
      position += 1;
      setText(after.slice(0, position));
      if (position < after.length) timer = setTimeout(type, Math.min(35, 1100 / after.length));
    };
    timer = setTimeout(type, 320);
    return () => clearTimeout(timer);
  }, [before, after, editing, edited, reduced]);
  return text;
}

function PropertyCreative({ template, title, editing = false }: {
  template: typeof WORKFLOW_TEMPLATES[number]; title?: string; editing?: boolean;
}) {
  return <div className="wf-art">
    <div className="wf-art-photo">
      <img src={withBasePath(template.image)} alt="" width="1080" height="1350" />
      <span className="wf-art-brand">WCH<span>WEST COAST<br />HOME CO</span></span>
    </div>
    <div className="wf-art-caption">
      <strong className={`wf-art-title${editing ? " is-editing" : ""}`}>{title ?? template.title}{editing && <i className="wf-caret" />}</strong>
      <span className="wf-art-suburb">{template.id === "listing" ? AD.subtitle : template.detail}</span>
      <span className="wf-art-facts">{template.id === "listing" ? template.detail : "West Coast Home Co"}</span>
    </div>
  </div>;
}

function StudioAd({ frame, title, post }: { frame: Frame; title: string; post: string }) {
  return <article className="wf-ad" aria-label="Example Facebook property ad">
    <div className="wf-ad-account"><span className="wf-avatar">{AD.initials}</span><span><strong>{AD.agency}</strong><small>Sponsored · <span aria-hidden="true">◎</span></small></span><MoreHorizontal size={16} /></div>
    <p className={`wf-post${frame.index === 3 ? " is-editing" : ""}`}>{post}{frame.index === 3 && <i className="wf-caret" />}</p>
    <div className="wf-ad-art-stack">
      {WORKFLOW_TEMPLATES.slice(0, 2).map((template, index) => <div key={template.id} className={`wf-ad-art-layer${frame.template === index ? " is-active" : ""}`} aria-hidden={frame.template !== index}>
        <PropertyCreative template={template} title={index === 1 ? title : undefined} editing={index === 1 && frame.index === 4} />
      </div>)}
    </div>
    <div className="wf-ad-link"><span><small>{AD.domain}</small><strong>Explore the property</strong></span><span>Learn more</span></div>
  </article>;
}

function StudioInspector({ frame, post, title }: { frame: Frame; post: string; title: string }) {
  return <div className="wf-inspector">
    <div className={`wf-inspector-pane wf-template-info${frame.step === 0 ? " is-current" : ""}`} aria-hidden={frame.step !== 0}>
      <h3>{WORKFLOW_TEMPLATES[frame.template].label}</h3>
      <dl><div><dt>Format</dt><dd>Facebook Feed</dd></div><div><dt>Size</dt><dd>1080 × 1350</dd></div></dl>
      <span className={`wf-selection-state${frame.index === 1 ? " is-selected" : ""}`}><Check size={14} />Template selected</span>
    </div>
    <div className={`wf-inspector-pane wf-fields${frame.step === 1 ? " is-current" : ""}`} aria-hidden={frame.step !== 1}>
      <h3>Customise</h3>
      <label className={frame.index === 3 ? "is-editing" : ""}><span>Post copy</span><span className="wf-field-value">{post}{frame.index === 3 && <i className="wf-caret" />}</span></label>
      <label className={frame.index === 4 ? "is-editing" : ""}><span>Ad headline</span><span className="wf-field-value wf-field-value--title">{title}{frame.index === 4 && <i className="wf-caret" />}</span></label>
      <span className="wf-saved"><Check size={12} />{frame.index < 4 ? "Changes saved" : "Creative updated"}</span>
    </div>
    <div className={`wf-inspector-pane wf-review${frame.step === 2 ? " is-current" : ""}`} aria-hidden={frame.step !== 2}>
      <h3>Review campaign</h3>
      <dl>{[["Audience", "Subiaco +15 km"], ["Budget", "$20 / day"], ["Duration", "14 days"]].map(([label, value], index) => <div key={label}><dt>{label}</dt><dd><span className={frame.filled ? "is-filled" : ""} style={{ transitionDelay: `${index * 100}ms` }}>{value}</span></dd></div>)}</dl>
      <div className={`wf-approve${frame.pressing ? " is-pressing" : ""}${frame.approved ? " is-approved" : ""}`}><ShieldCheck size={15} /><span>{frame.approved ? "Campaign approved" : "Approve campaign"}</span></div>
    </div>
  </div>;
}

export function WorkflowShowcase() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const frame = workflowFrame(phase);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { setReduced(preference.matches); setPhase(preference.matches ? WORKFLOW_PHASES.length - 1 : 0); };
    const syncPage = () => setPageVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    syncMotion(); syncPage();
    if (stageRef.current) observer.observe(stageRef.current);
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncPage);
    return () => { observer.disconnect(); preference.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncPage); };
  }, []);
  useEffect(() => {
    if (reduced || !visible || !pageVisible) return;
    const timer = setTimeout(() => setPhase(nextWorkflowPhase), WORKFLOW_PHASES[phase].duration);
    return () => clearTimeout(timer);
  }, [phase, reduced, visible, pageVisible]);

  const post = useTypedText(AD.startingCopy, AD.editedCopy, phase === 3, frame.postEdited, reduced);
  const title = useTypedText(AD.startingTitle, AD.editedTitle, phase === 4, frame.titleEdited, reduced);

  return <div className="hc-process-layout">
    <div className="hc-process-copy">
      <h2>Create real estate ads for Facebook &amp; Instagram.</h2>
      <div className="hc-process-steps" aria-label="How Blockwise works">{WORKFLOW_STEPS.map((step, index) => <button type="button" key={step} aria-pressed={frame.step === index} onClick={() => setPhase(WORKFLOW_STEP_STARTS[index])}><span className="hc-process-step-mark" aria-hidden="true" /><strong>{step}</strong></button>)}</div>
      <div className="hc-process-actions"><a className="hc-button hc-button--primary" href={TRIAL_SIGNUP_URL}>{TRIAL_CTA_LABEL}<ArrowRight size={17} aria-hidden="true" /></a></div>
    </div>
    <div className="wf-studio" ref={stageRef} data-step={frame.step} data-phase={phase} aria-label="Example ad creation workflow">
      <div className="wf-topbar"><span><i aria-hidden="true" />Blockwise Ad Studio</span><ol aria-hidden="true">{WORKFLOW_STEPS.map((step, index) => <li key={step} className={frame.step === index ? "is-active" : ""}>{step}</li>)}</ol></div>
      <p className="hc-sr-only">{frame.label}. Example only. No campaign is published.</p>
      <div className="wf-workspace" aria-hidden="true">
        <aside className="wf-library"><strong>Templates</strong><div className="wf-template-list">{WORKFLOW_TEMPLATES.map((template, index) => <div key={template.id} className={`wf-template${frame.template === index ? " is-selected" : ""}`}><div className="wf-template-art"><PropertyCreative template={template} /></div><span>{template.label}</span><i><Check size={10} /></i></div>)}</div></aside>
        <div className="wf-ad-position"><StudioAd frame={frame} post={post} title={title} /></div>
        <StudioInspector frame={frame} post={post} title={title} />
      </div>
    </div>
  </div>;
}
