"use client";

import {
  ArrowRight,
  Check,
  MoreHorizontal,
  MousePointer2,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";

import "./workflow-showcase.css";

const PROCESS_STEPS = [
  { label: "Choose" },
  { label: "Customise" },
  { label: "Review" },
] as const;

const STORY_PHASE_DELAYS = [950, 900, 900, 950, 1100, 650, 950, 650, 1200] as const;
const STORY_STEP_PHASES = [1, 2, 5] as const;
const STORY_PHASE_TO_STEP = [0, 0, 1, 1, 1, 2, 2, 2, 2] as const;
const STORY_TEMPLATE_SEQUENCE = [0, 1, 2, 0] as const;
const STORY_STATUS = [
  "Choose a template",
  "Template selected",
  "Customise the ad",
  "Editing the post copy",
  "Editing text on the creative",
  "Review campaign",
  "Campaign details filled",
  "Approve campaign",
  "Campaign approved",
] as const;

const STORY_CREATIVE = {
  image: "/home/subiaco-townhouse.webp",
  account: "West Coast Home Co",
  avatar: "WCH",
  startingCopy: "A better way to spend summer starts at home.",
  editedCopy: "A better way to spend summer starts at home. Explore the new guide.",
  startingOverlay: "YOUR NEXT HOME",
  editedOverlay: "YOUR SUBIACO HOME",
  domain: "WESTCOASTHOME.CO",
  linkTitle: "Get the suburb property guide",
} as const;

const STORY_EASE = [0.22, 1, 0.36, 1] as const;
const STORY_MOVE = { duration: 0.62, ease: STORY_EASE };
const STORY_ENTER = { duration: 0.42, ease: STORY_EASE };
const STORY_EXIT = { duration: 0.22, ease: [0.4, 0, 1, 1] as const };

function StoryCursor({ pressed = false }: { pressed?: boolean }) {
  return (
    <motion.span
      layoutId="story-cursor"
      className="hc-story-cursor"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, scale: pressed ? 0.88 : 1 }}
      exit={{ opacity: 0, y: 4 }}
      transition={pressed ? { duration: 0.14, ease: "easeInOut" } : STORY_ENTER}
    >
      <MousePointer2 aria-hidden="true" size={22} strokeWidth={2.2} />
    </motion.span>
  );
}

function StoryOverlayText({ editing, edited }: { editing: boolean; edited: boolean }) {
  if (!editing) return <>{edited ? STORY_CREATIVE.editedOverlay : STORY_CREATIVE.startingOverlay}</>;

  return (
    <>
      <span className="hc-story-selection">{STORY_CREATIVE.startingOverlay}</span>
      <span className="hc-story-replacement" aria-label={STORY_CREATIVE.editedOverlay}>
        {Array.from(STORY_CREATIVE.editedOverlay).map((character, index) => (
          <motion.span
            key={`${character}-${index}`}
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            transition={{ delay: index * 0.045, duration: 0.08, ease: "linear" }}
          >
            {character === " " ? "\u00a0" : character}
          </motion.span>
        ))}
      </span>
      <span className="hc-story-caret" />
    </>
  );
}

function StoryAd({ phase, review = false }: { phase: number; review?: boolean }) {
  const copyEdited = phase >= 3;
  const creativeEdited = phase >= 4;

  return (
    <motion.article layoutId="story-ad" className={`hc-story-ad${review ? " is-review" : ""}`} transition={STORY_MOVE}>
      <div className="hc-ad-account">
        <span className="hc-ad-avatar" aria-hidden="true">{STORY_CREATIVE.avatar}</span>
        <span><strong>{STORY_CREATIVE.account}</strong><small>Sponsored</small></span>
        <MoreHorizontal aria-hidden="true" size={18} />
      </div>
      <motion.p
        className={`hc-ad-copy${phase === 3 ? " is-editing" : ""}`}
        key={copyEdited ? "edited-copy" : "starting-copy"}
        initial={{ opacity: 0.35, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={STORY_ENTER}
      >
        {copyEdited ? STORY_CREATIVE.editedCopy : STORY_CREATIVE.startingCopy}{phase === 3 ? <span className="hc-story-caret" /> : null}
      </motion.p>
      <motion.div layoutId="story-template-image" className="hc-ad-image-wrap hc-story-ad-image" transition={STORY_MOVE}>
        <img src={withBasePath(STORY_CREATIVE.image)} alt="" width="1080" height="1350" />
        <motion.span
          className={`hc-story-creative-overlay${phase === 4 ? " is-editing" : ""}`}
          role="textbox"
          aria-label="Text on creative"
          aria-readonly="true"
          data-editing-target="creative"
          key={creativeEdited ? "edited-creative" : "starting-creative"}
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={STORY_ENTER}
        >
          <StoryOverlayText editing={phase === 4} edited={creativeEdited} />
        </motion.span>
      </motion.div>
      <div className="hc-ad-link">
        <span><small>{STORY_CREATIVE.domain}</small><strong>{STORY_CREATIVE.linkTitle}</strong></span>
        <span className="hc-ad-link-button">Learn more</span>
      </div>
    </motion.article>
  );
}

function TemplateBrowser({ phase }: { phase: number }) {
  const activeTemplate = STORY_TEMPLATE_SEQUENCE[Math.min(phase, STORY_TEMPLATE_SEQUENCE.length - 1)];
  const selected = phase === 1;

  return (
    <motion.div
      key="templates"
      className="hc-story-scene hc-story-browser"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -34, filter: "blur(3px)" }}
      transition={{ ...STORY_EXIT, opacity: { duration: 0.18 } }}
    >
      <div className="hc-story-scene-heading">
        <span>Ready-made ads</span>
        <strong>{selected ? "Template selected" : "Choose a starting point"}</strong>
      </div>
      <div className="hc-story-template-window">
        <motion.div
          className="hc-story-template-track"
          animate={{ x: `-${[0, 15, 31, 0][Math.min(phase, 3)]}%` }}
          transition={STORY_MOVE}
        >
          {AD_EXAMPLES.slice(0, 3).map((example, index) => {
            const active = index === activeTemplate;
            return (
              <motion.div
                className={`hc-story-template-card${active ? " is-active" : ""}${selected && active ? " is-selected" : ""}`}
                key={example.id}
                animate={{ opacity: active ? 1 : 0.62, scale: active ? 1 : 0.965 }}
                transition={STORY_MOVE}
              >
                <motion.div
                  layoutId={selected && active ? "story-template-image" : undefined}
                  className="hc-story-template-image"
                  transition={STORY_MOVE}
                >
                  <img src={withBasePath(index === 1 ? STORY_CREATIVE.image : example.image)} alt="" width="1080" height="1350" />
                  {selected && active ? <span className="hc-story-selected"><Check aria-hidden="true" size={13} /> Selected</span> : null}
                </motion.div>
                <span><strong>{index === 1 ? "Suburb guide" : example.label}</strong><small>Facebook &amp; Instagram</small></span>
                {active ? <StoryCursor pressed={selected} /> : null}
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

function EditorScene({ phase }: { phase: number }) {
  const copyActive = phase === 3;
  const creativeActive = phase === 4;

  return (
    <motion.div
      key="editor"
      className="hc-story-scene hc-story-editor"
      initial={{ opacity: 0, x: 38 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30, filter: "blur(3px)" }}
      transition={STORY_ENTER}
    >
      <aside className="hc-story-mini-rail">
        <span>Templates</span>
        <div className="is-selected">
          <img src={withBasePath(STORY_CREATIVE.image)} alt="" width="1080" height="1350" />
        </div>
      </aside>

      <div className="hc-story-ad-workspace">
        <StoryAd phase={phase} />
      </div>

      <div className="hc-story-edit-panel">
        <span>Customise</span>
        <h3>Make it yours</h3>
        <label className={copyActive ? "is-active" : ""}>
          <span>Post copy</span>
          <motion.strong
            key={phase >= 3 ? "new-post-copy" : "old-post-copy"}
            initial={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={STORY_ENTER}
          >
            {phase >= 3 ? STORY_CREATIVE.editedCopy : STORY_CREATIVE.startingCopy}
            {copyActive ? <span className="hc-story-caret" /> : null}
          </motion.strong>
        </label>
        <label className={creativeActive ? "is-active" : ""}>
          <span>Text on creative</span>
          <motion.strong
            key={phase >= 4 ? "new-creative-copy" : "old-creative-copy"}
            initial={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={STORY_ENTER}
          >
            {phase >= 4 ? STORY_CREATIVE.editedOverlay : STORY_CREATIVE.startingOverlay}
            {creativeActive ? <span className="hc-story-caret" /> : null}
          </motion.strong>
        </label>
      </div>
    </motion.div>
  );
}

function ReviewScene({ phase }: { phase: number }) {
  const valuesFilled = phase >= 6;
  const pressing = phase === 7;
  const approved = phase >= 8;

  return (
    <motion.div
      key="review"
      className="hc-story-scene hc-story-review"
      initial={{ opacity: 0, x: 38 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={STORY_ENTER}
    >
      <div className="hc-story-review-preview">
        <StoryAd phase={phase} review />
      </div>

      <motion.div className="hc-story-review-panel" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ ...STORY_ENTER, delay: 0.14 }}>
        <h3>Review campaign</h3>
        <dl>
          {[
            ["Audience", "Mt Lawley +15 km"],
            ["Budget", "$20 / day"],
            ["Duration", "14 days"],
          ].map(([label, value], index) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={valuesFilled ? value : `${label}-empty`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ ...STORY_ENTER, delay: valuesFilled ? index * 0.12 : 0 }}
                  >
                    {valuesFilled ? value : ""}
                  </motion.span>
                </AnimatePresence>
              </dd>
            </div>
          ))}
        </dl>
        <motion.strong
          className={`hc-story-approve${approved ? " is-approved" : ""}`}
          animate={{ scale: pressing ? 0.97 : 1 }}
          transition={{ duration: 0.15, ease: "easeInOut" }}
        >
          <ShieldCheck aria-hidden="true" size={15} />
          {approved ? "Campaign approved" : "Approve campaign"}
          {pressing ? <StoryCursor pressed /> : null}
        </motion.strong>
      </motion.div>
    </motion.div>
  );
}

export function WorkflowShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const hasStarted = useRef(false);
  const reduceMotion = Boolean(useReducedMotion());
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const activeStep = STORY_PHASE_TO_STEP[phase];

  useEffect(() => {
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && !reduceMotion && !hasStarted.current) {
          hasStarted.current = true;
          setPhase(0);
          setPlaying(true);
        }
      },
      { threshold: 0.3 },
    );

    syncVisibility();
    if (sectionRef.current) observer.observe(sectionRef.current);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      setPhase(STORY_STATUS.length - 1);
      setPlaying(false);
    }
  }, [reduceMotion]);

  useEffect(() => {
    if (!playing || !inView || !pageVisible || reduceMotion) return;

    const timer = window.setTimeout(
      () => setPhase((current) => current >= STORY_STATUS.length - 1 ? 0 : current + 1),
      STORY_PHASE_DELAYS[phase],
    );
    return () => window.clearTimeout(timer);
  }, [inView, pageVisible, phase, playing, reduceMotion]);

  function selectStep(nextStep: number) {
    setPhase(STORY_STEP_PHASES[nextStep]);
    setPlaying(!reduceMotion);
  }

  const scene = phase <= 1 ? "browse" : phase <= 4 ? "edit" : "review";

  return (
    <div className="hc-process-layout" ref={sectionRef}>
      <div className="hc-process-copy">
        <h2>Create real estate ads for Facebook &amp; Instagram.</h2>

        <div className="hc-process-steps" aria-label="How Blockwise works">
          {PROCESS_STEPS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={activeStep === index}
              onClick={() => selectStep(index)}
            >
              <span className="hc-process-step-mark" aria-hidden="true" />
              <span><strong>{item.label}</strong></span>
            </button>
          ))}
        </div>

        <div className="hc-process-actions">
          <a className="hc-button hc-button--primary" href="#trial">
            Start free trial
            <ArrowRight aria-hidden="true" size={17} />
          </a>
        </div>
      </div>

      <div className="hc-process-demo" data-scene={scene} aria-label="Animated example of creating and approving an ad">
        <div className="hc-process-demo-topbar">
          <span><i aria-hidden="true" /> Blockwise Ad Studio</span>
          <ol aria-hidden="true">
            {PROCESS_STEPS.map((item, index) => <li className={activeStep === index ? "is-active" : ""} key={item.label}>{item.label}</li>)}
          </ol>
        </div>

        <p className="hc-sr-only" aria-live="polite">{STORY_STATUS[phase]}</p>
        <LayoutGroup id="blockwise-story">
          <div className="hc-story-viewport" aria-hidden="true">
            <AnimatePresence mode="sync" initial={false}>
              {scene === "browse" ? <TemplateBrowser phase={phase} /> : null}
              {scene === "edit" ? <EditorScene phase={phase} /> : null}
              {scene === "review" ? <ReviewScene phase={phase} /> : null}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </div>
    </div>
  );
}
