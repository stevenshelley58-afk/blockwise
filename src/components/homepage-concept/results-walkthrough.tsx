"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Inbox,
  LayoutTemplate,
  Palette,
  ShieldCheck,
} from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";

import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";
import {
  EXAMPLE_BUDGET,
  EXAMPLE_ENQUIRIES,
  WALKTHROUGH_STEPS,
  type WalkthroughStepId,
} from "@/lib/homepage-concept/walkthrough";
import { durations, useReducedMotion } from "@/lib/motion";

const STEP_ICONS = {
  create: LayoutTemplate,
  approve: ShieldCheck,
  enquiries: Inbox,
} as const;

function CreateVignette({
  creativeIndex,
  instant,
  reducedMotion,
  onCreativeChange,
}: {
  creativeIndex: number;
  instant: boolean;
  reducedMotion: boolean | null;
  onCreativeChange: (index: number, keyboardInitiated: boolean) => void;
}) {
  const activeCreative = AD_EXAMPLES[creativeIndex];

  return (
    <div className="hc-create-vignette">
      <div className="hc-create-controls">
        <div className="hc-field-preview">
          <span>Campaign</span>
          <strong>Seller appraisal</strong>
        </div>
        <div className="hc-field-preview">
          <span>Message</span>
          <strong>{activeCreative.linkTitle}</strong>
        </div>
        <div className="hc-creative-choice" role="group" aria-label="Choose an example creative">
          <span>Creative</span>
          {AD_EXAMPLES.slice(0, 2).map((example, index) => (
            <button
              type="button"
              key={example.id}
              aria-pressed={creativeIndex === index}
              onClick={(event) => onCreativeChange(index, event.detail === 0)}
            >
              <span className="hc-creative-swatch" aria-hidden="true">
                <img src={withBasePath(example.image)} alt="" width="1080" height="1350" />
              </span>
              {example.label}
            </button>
          ))}
        </div>
        <p className="hc-create-ready">
          <CheckCircle2 aria-hidden="true" size={17} />
          Ready for budget review
        </p>
      </div>
      <figure className="hc-walkthrough-creative">
        <motion.div
          key={activeCreative.id}
          initial={reducedMotion || instant ? false : { opacity: 0, transform: "translateX(12px)" }}
          animate={{ opacity: 1, transform: "translateX(0)" }}
          transition={{ duration: reducedMotion || instant ? 0 : durations.state, ease: [0.22, 1, 0.36, 1] }}
        >
          <img
            src={withBasePath(activeCreative.image)}
            alt={`${activeCreative.label} real-estate ad creative`}
            width="1080"
            height="1350"
          />
        </motion.div>
        <figcaption>
          <Palette aria-hidden="true" size={15} />
          Your brand and message, together
        </figcaption>
      </figure>
    </div>
  );
}

function BudgetVignette({
  dailyBudget,
  approved,
  onBudgetChange,
  onApproval,
}: {
  dailyBudget: number;
  approved: boolean;
  onBudgetChange: (value: number) => void;
  onApproval: () => void;
}) {
  const plannedSpend = dailyBudget * EXAMPLE_BUDGET.days;

  return (
    <div className="hc-budget-vignette">
      <div className="hc-budget-controls">
        <div className="hc-budget-heading">
          <div>
            <span>Daily budget</span>
            <strong><output aria-live="polite">${dailyBudget}</output> AUD</strong>
          </div>
          <span>{EXAMPLE_BUDGET.days} days</span>
        </div>
        <input
          type="range"
          min={EXAMPLE_BUDGET.minDaily}
          max={EXAMPLE_BUDGET.maxDaily}
          step="5"
          value={dailyBudget}
          aria-label="Example daily ad budget in Australian dollars"
          onChange={(event) => onBudgetChange(Number(event.target.value))}
        />
        <div className="hc-budget-range" aria-hidden="true">
          <span>${EXAMPLE_BUDGET.minDaily}</span>
          <span>${EXAMPLE_BUDGET.maxDaily}</span>
        </div>
        <dl className="hc-budget-facts">
          <div><dt>Schedule</dt><dd>14 days</dd></div>
          <div><dt>Planned ad spend</dt><dd>${plannedSpend} AUD</dd></div>
          <div><dt>Paid through</dt><dd>Your Meta ad account</dd></div>
        </dl>
      </div>
      <div className="hc-budget-review">
        <h4>Review before approval</h4>
        <ul>
          <li><Check aria-hidden="true" size={16} /> Creative and destination checked</li>
          <li><Check aria-hidden="true" size={16} /> Budget and schedule visible</li>
          <li><Check aria-hidden="true" size={16} /> Nothing publishes automatically</li>
        </ul>
        <button
          className="hc-example-approval"
          type="button"
          aria-pressed={approved}
          onClick={onApproval}
          disabled={approved}
        >
          {approved ? <CheckCircle2 aria-hidden="true" size={18} /> : <ShieldCheck aria-hidden="true" size={18} />}
          {approved ? "Example budget approved" : "Approve example budget"}
        </button>
        <p role="status" aria-live="polite">
          {approved
            ? "Approval recorded in this example only."
            : "Illustration only - no ad will publish or spend."}
        </p>
      </div>
    </div>
  );
}

function EnquiriesVignette() {
  return (
    <div className="hc-enquiries-vignette">
      <div className="hc-enquiries-context">
        <div>
          <strong>{EXAMPLE_ENQUIRIES.length} incoming enquiries</strong>
          <span>Free appraisal ad</span>
        </div>
        <div>
          <strong>${EXAMPLE_BUDGET.spendToDate} AUD</strong>
          <span>Example spend to date</span>
        </div>
      </div>
      <ul className="hc-enquiry-list" aria-label="Example incoming enquiries">
        {EXAMPLE_ENQUIRIES.map((enquiry) => (
          <li key={enquiry.name}>
            <span className="hc-enquiry-avatar" aria-hidden="true">{enquiry.name.charAt(0)}</span>
            <span className="hc-enquiry-person">
              <strong>{enquiry.name}</strong>
              <small>{enquiry.location}</small>
            </span>
            <span className="hc-enquiry-source">
              <small>Source</small>
              <strong>{enquiry.source}</strong>
            </span>
            <span className="hc-enquiry-time">
              <small>{enquiry.received}</small>
              <span data-status={enquiry.status.toLowerCase()}>{enquiry.status}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="hc-enquiries-note">
        <Inbox aria-hidden="true" size={17} />
        See which ad brought each enquiry in, then pick up the conversation.
      </p>
    </div>
  );
}

export function ResultsWalkthrough() {
  const [activeId, setActiveId] = useState<WalkthroughStepId>("create");
  const [creativeIndex, setCreativeIndex] = useState(0);
  const [dailyBudget, setDailyBudget] = useState<number>(EXAMPLE_BUDGET.initialDaily);
  const [approved, setApproved] = useState(false);
  const [instant, setInstant] = useState(false);
  const reducedMotion = useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeStep = WALKTHROUGH_STEPS.find((step) => step.id === activeId) ?? WALKTHROUGH_STEPS[0];

  function selectStep(id: WalkthroughStepId, keyboardInitiated = false) {
    setInstant(keyboardInitiated);
    setActiveId(id);
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % WALKTHROUGH_STEPS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + WALKTHROUGH_STEPS.length) % WALKTHROUGH_STEPS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = WALKTHROUGH_STEPS.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectStep(WALKTHROUGH_STEPS[nextIndex].id, true);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="hc-results" id="results">
      <div className="hc-shell">
        <div className="hc-results-intro">
          <div>
            <h2>Less managing ads. More meeting sellers.</h2>
            <p>Blockwise brings branded ad creation, budget approval and incoming enquiries into one workspace.</p>
          </div>
          <div className="hc-results-value">
            <p>Make the ad. Review the spend. Find the people to follow up with - without switching tools at every step.</p>
            <div>
              <a className="hc-button hc-button--primary" href="#trial">
                Start free trial
                <ArrowRight aria-hidden="true" size={17} />
              </a>
              <span>No card required</span>
            </div>
          </div>
        </div>

        <div className="hc-walkthrough">
          <div className="hc-walkthrough-steps" role="tablist" aria-label="Explore the Blockwise workflow">
            {WALKTHROUGH_STEPS.map((step, index) => {
              const Icon = STEP_ICONS[step.id];
              return (
                <button
                  ref={(node) => { tabRefs.current[index] = node; }}
                  key={step.id}
                  id={`walkthrough-tab-${step.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeId === step.id}
                  aria-controls="walkthrough-panel"
                  tabIndex={activeId === step.id ? 0 : -1}
                  onClick={(event) => selectStep(step.id, event.detail === 0)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <span className="hc-walkthrough-step-icon"><Icon aria-hidden="true" size={19} /></span>
                  <span>
                    <small>Step {index + 1}</small>
                    <strong>{step.label}</strong>
                  </span>
                  <ChevronRight className="hc-walkthrough-step-arrow" aria-hidden="true" size={18} />
                </button>
              );
            })}
          </div>

          <div className="hc-walkthrough-window">
            <div className="hc-walkthrough-bar">
              <span>Seller appraisal campaign</span>
              <span>Illustrative walkthrough <i aria-hidden="true" /> Example data</span>
            </div>
            <motion.div
              className="hc-walkthrough-panel"
              key={activeStep.id}
              id="walkthrough-panel"
              role="tabpanel"
              aria-labelledby={`walkthrough-tab-${activeStep.id}`}
              tabIndex={0}
              initial={reducedMotion || instant ? false : { opacity: 0, transform: "translateX(18px)" }}
              animate={{ opacity: 1, transform: "translateX(0)" }}
              transition={{ duration: reducedMotion || instant ? 0 : durations.state, ease: [0.22, 1, 0.36, 1] }}
            >
                <div className="hc-walkthrough-copy">
                  <h3>{activeStep.title}</h3>
                  <p>{activeStep.body}</p>
                  <div className="hc-walkthrough-payoff">
                    <ArrowRight aria-hidden="true" size={18} />
                    <span>{activeStep.benefit}</span>
                  </div>
                </div>
                <div className="hc-walkthrough-vignette">
                  {activeStep.id === "create" && (
                    <CreateVignette
                      creativeIndex={creativeIndex}
                      instant={instant}
                      reducedMotion={reducedMotion}
                      onCreativeChange={(index, keyboardInitiated) => {
                        setInstant(keyboardInitiated);
                        setCreativeIndex(index);
                        setApproved(false);
                      }}
                    />
                  )}
                  {activeStep.id === "approve" && (
                    <BudgetVignette
                      dailyBudget={dailyBudget}
                      approved={approved}
                      onBudgetChange={(value) => {
                        setDailyBudget(value);
                        setApproved(false);
                      }}
                      onApproval={() => setApproved(true)}
                    />
                  )}
                  {activeStep.id === "enquiries" && <EnquiriesVignette />}
                </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
