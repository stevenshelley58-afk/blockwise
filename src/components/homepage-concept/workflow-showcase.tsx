"use client";

import { ArrowRight, Check, MoreHorizontal, ShieldCheck } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { withBasePath } from "@/lib/homepage-concept/content";
import { TRIAL_CTA_LABEL, TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import {
  WORKFLOW_AD as AD,
  WORKFLOW_REVIEW,
  WORKFLOW_STEPS,
  WORKFLOW_TEMPLATES,
  type WorkflowStepId,
} from "@/lib/homepage-concept/workflow";
import "./workflow-showcase.css";

function PropertyCreative({ image, title }: { image: string; title: string }) {
  return (
    <div className="wf-art">
      <div className="wf-art-photo">
        <img src={withBasePath(image)} alt="" width="1080" height="1350" loading="lazy" />
        <span className="wf-art-brand">
          {AD.initials}<span>WEST COAST<br />HOME CO</span>
        </span>
        <span className="wf-example-label">Example ad</span>
      </div>
      <div className="wf-art-caption">
        <strong className="wf-art-title">{title || "Property appraisal"}</strong>
        <span>{AD.suburb}</span>
        <small>{AD.agency}</small>
      </div>
    </div>
  );
}

function AdPreview({ templateIndex, post, title }: { templateIndex: number; post: string; title: string }) {
  const template = WORKFLOW_TEMPLATES[templateIndex];
  return (
    <article className="wf-ad" aria-label="Example Facebook appraisal ad preview">
      <header className="wf-ad-account">
        <span className="wf-avatar">{AD.initials}</span>
        <span><strong>{AD.agency}</strong><small>Sponsored · Public</small></span>
        <MoreHorizontal size={18} aria-hidden="true" />
      </header>
      <p className="wf-post">{post || "Add your post copy"}</p>
      <div className="wf-ad-art"><PropertyCreative image={template.image} title={title} /></div>
      <footer className="wf-ad-link">
        <span><small>{AD.domain}</small><strong>{AD.linkTitle}</strong></span>
        <span>Learn more</span>
      </footer>
    </article>
  );
}

export function WorkflowShowcase() {
  const [step, setStep] = useState<WorkflowStepId>("choose");
  const [templateIndex, setTemplateIndex] = useState(0);
  const [post, setPost] = useState<string>(AD.defaultCopy);
  const [title, setTitle] = useState<string>(AD.defaultTitle);
  const [budget, setBudget] = useState<number>(WORKFLOW_REVIEW.defaultDailyBudget);
  const [duration, setDuration] = useState<number>(WORKFLOW_REVIEW.defaultDuration);
  const [approved, setApproved] = useState(false);
  const plannedSpend = budget * duration;

  function chooseTemplate(index: number) {
    setTemplateIndex(index);
    setApproved(false);
  }

  function updatePost(value: string) {
    setPost(value);
    setApproved(false);
  }

  function updateTitle(value: string) {
    setTitle(value);
    setApproved(false);
  }

  return (
    <div className="hc-process-layout">
      <div className="hc-process-copy">
        <h2>Create the ad. Keep control.</h2>
        <p>Choose a template, customise the message, then set the budget and approve the campaign yourself.</p>
        <div className="hc-process-steps" role="group" aria-label="Example campaign steps">
          {WORKFLOW_STEPS.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={step === item.id}
              onClick={() => setStep(item.id)}
            >
              <span className="hc-process-step-mark" aria-hidden="true" />
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
        <div className="hc-process-actions">
          <a className="hc-button hc-button--primary" href={TRIAL_SIGNUP_URL}>
            {TRIAL_CTA_LABEL}<ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="wf-studio" data-step={step} aria-label="Interactive example of creating an appraisal ad">
        <header className="wf-topbar">
          <span><i aria-hidden="true" />Blockwise Ad Studio</span>
          <span>Example only</span>
        </header>

        <div className="wf-workspace">
          <div className="wf-ad-position">
            <AdPreview templateIndex={templateIndex} post={post} title={title} />
          </div>

          <section className="wf-controls" aria-live="polite">
            {step === "choose" ? (
              <div className="wf-control-panel">
                <h3>Choose a template</h3>
                <p>Three layouts for the same appraisal campaign.</p>
                <div className="wf-template-list" role="group" aria-label="Example ad templates">
                  {WORKFLOW_TEMPLATES.map((template, index) => (
                    <button
                      type="button"
                      key={template.id}
                      className="wf-template"
                      aria-pressed={templateIndex === index}
                      onClick={() => chooseTemplate(index)}
                    >
                      <span className="wf-template-art"><PropertyCreative image={template.image} title={title} /></span>
                      <span><strong>{template.label}</strong><small>{template.detail}</small></span>
                      {templateIndex === index ? <Check size={16} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {step === "customise" ? (
              <div className="wf-control-panel">
                <h3>Customise the message</h3>
                <label>
                  <span>Post copy</span>
                  <textarea value={post} rows={4} maxLength={180} onChange={(event) => updatePost(event.target.value)} />
                </label>
                <label>
                  <span>Ad headline</span>
                  <input value={title} maxLength={48} onChange={(event) => updateTitle(event.target.value)} />
                </label>
                <small className="wf-character-count">{title.length}/48</small>
              </div>
            ) : null}

            {step === "review" ? (
              <div className="wf-control-panel wf-review">
                <div className="wf-review-head">
                  <div><h3>Budget &amp; review</h3><p>{AD.campaign}</p></div>
                  <span className={approved ? "is-approved" : ""}>{approved ? "Approved in this example" : "Draft example"}</span>
                </div>
                <label htmlFor="wf-budget">Daily Meta ad budget</label>
                <div className="wf-budget-value"><output htmlFor="wf-budget">${budget}</output><span>AUD / day</span></div>
                <input
                  id="wf-budget"
                  className="wf-budget-range"
                  type="range"
                  min={WORKFLOW_REVIEW.minDailyBudget}
                  max={WORKFLOW_REVIEW.maxDailyBudget}
                  step="5"
                  value={budget}
                  onChange={(event) => { setBudget(Number(event.target.value)); setApproved(false); }}
                  style={{ "--range-fill": `${(budget - WORKFLOW_REVIEW.minDailyBudget) / (WORKFLOW_REVIEW.maxDailyBudget - WORKFLOW_REVIEW.minDailyBudget) * 100}%` } as CSSProperties}
                />
                <div className="wf-review-fields">
                  <label><span>Duration</span><select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setApproved(false); }}>{WORKFLOW_REVIEW.durations.map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
                  <div><span>Audience</span><strong>{WORKFLOW_REVIEW.audience}</strong></div>
                </div>
                <div className="wf-spend-total"><span>Planned Meta ad spend</span><strong>${plannedSpend.toLocaleString("en-AU")} AUD</strong></div>
                <p className="wf-budget-note">Meta ad spend is paid separately to Meta.</p>
                <button type="button" className="wf-approve" onClick={() => setApproved((value) => !value)} aria-pressed={approved}>
                  <ShieldCheck size={17} aria-hidden="true" />
                  {approved ? "Return to draft" : "Approve this example"}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <p className="wf-disclosure">Interactive example. Changes stay on this page. Nothing is saved, published or sent to Meta.</p>
      </div>
    </div>
  );
}
