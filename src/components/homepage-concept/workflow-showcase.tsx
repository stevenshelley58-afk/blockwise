"use client";

import {
  ArrowRight,
  Check,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Share2,
  ShieldCheck,
  ThumbsUp,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";

import "./workflow-showcase.css";

const PROCESS_STEPS = [
  { label: "Choose", hint: "Pick a ready-made template" },
  { label: "Customise", hint: "Change the wording and image" },
  { label: "Review", hint: "Set the budget and go live" },
] as const;

const STORY_PHASE_DELAYS = [1100, 1000, 1000, 1100, 1200, 850, 1050, 750, 1400] as const;
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

/** Extra template cards shown in the browser to make the library look deep. */
const BROWSER_CARDS = [
  ...AD_EXAMPLES,
  { id: "open-home", label: "Open home", image: AD_EXAMPLES[2].image },
  { id: "just-sold", label: "Just sold", image: AD_EXAMPLES[0].image },
  { id: "market-update", label: "Market update", image: AD_EXAMPLES[3].image },
] as const;

const STORY_EASE = [0.16, 1, 0.3, 1] as const;
const STORY_MOVE = { duration: 0.55, ease: STORY_EASE };
const STORY_ENTER = { duration: 0.45, ease: STORY_EASE };
const STORY_EXIT = { duration: 0.25, ease: [0.32, 0, 0.67, 0] as const };

/** Entrance choreography: the section rises once, then its children cascade. */
const SECTION_IN_VIEW = { once: true, margin: "-12%" } as const;
const SECTION_RISE = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0 },
} as const;
const COPY_CASCADE = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
} as const;
const COPY_ITEM = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: STORY_EASE } },
} as const;
const DEMO_RISE = {
  hidden: { opacity: 0, scale: 0.97, y: 14 },
  shown: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.7, ease: STORY_EASE, delay: 0.12 } },
} as const;

function StoryCursor({ pressed = false }: { pressed?: boolean }) {
  return (
    <motion.span
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
    <span className="hc-story-replacement" aria-label={STORY_CREATIVE.editedOverlay}>
      {Array.from(STORY_CREATIVE.editedOverlay).map((character, index) => (
        <motion.span
          key={`${character}-${index}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * 0.045, duration: 0.06, ease: "linear" }}
        >
          {character === " " ? "\u00a0" : character}
        </motion.span>
      ))}
      <span className="hc-story-caret" />
    </span>
  );
}

function StoryAd({ phase, review = false }: { phase: number; review?: boolean }) {
  const copyEdited = phase >= 3;
  const creativeEdited = phase >= 4;

  return (
    <motion.article layoutId="story-ad" className={`hc-meta-ad hc-meta-feed hc-story-ad${review ? " is-review" : ""}`} transition={STORY_MOVE}>
      <header className="hc-meta-feed-head">
        <span className="hc-meta-avatar" aria-hidden="true">{STORY_CREATIVE.avatar}</span>
        <span><strong>{STORY_CREATIVE.account}</strong><small>Sponsored <Globe2 aria-hidden="true" size={9} /></small></span>
        <MoreHorizontal aria-hidden="true" size={16} />
      </header>
      <motion.p
        className={`hc-meta-feed-copy${phase === 3 ? " is-editing" : ""}`}
        key={copyEdited ? "edited-copy" : "starting-copy"}
        initial={{ opacity: 0.35, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={STORY_ENTER}
      >
        {copyEdited ? STORY_CREATIVE.editedCopy : STORY_CREATIVE.startingCopy}{phase === 3 ? <span className="hc-story-caret" /> : null}
      </motion.p>
      <motion.div layoutId="story-template-image" className="hc-story-ad-image" transition={STORY_MOVE}>
        <img src={withBasePath(STORY_CREATIVE.image)} alt="" width="1080" height="1350" />
        <span className="hc-story-image-shade" aria-hidden="true" />
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
      <div className="hc-meta-link-preview">
        <span><small>{STORY_CREATIVE.domain}</small><strong>{STORY_CREATIVE.linkTitle}</strong></span>
        <b>Learn more</b>
      </div>
      <div className="hc-meta-actions" aria-hidden="true">
        <span><ThumbsUp size={12} />Like</span>
        <span><MessageCircle size={12} />Comment</span>
        <span><Share2 size={12} />Share</span>
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
      exit={{ opacity: 0 }}
      transition={{ ...STORY_EXIT, opacity: { duration: 0.22 } }}
    >
      <div className="hc-story-scene-heading">
        <span>Ready-made ads</span>
        <strong>{selected ? "Template selected" : "Choose a starting point"}</strong>
      </div>
      <div className="hc-story-template-window">
        <motion.div
          className="hc-story-template-track"
          animate={{ x: `-${[0, 34, 0, 0][Math.min(phase, 3)]}%` }}
          transition={STORY_MOVE}
        >
          {BROWSER_CARDS.map((example, index) => {
            const active = index === activeTemplate;
            const isStoryCard = index === 1;
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
                  <img src={withBasePath(isStoryCard ? STORY_CREATIVE.image : example.image)} alt="" width="1080" height="1350" />
                  {selected && active ? <span className="hc-story-selected"><Check aria-hidden="true" size={13} /> Selected</span> : null}
                </motion.div>
                <span><strong>{isStoryCard ? "Suburb guide" : example.label}</strong><small>Facebook &amp; Instagram</small></span>
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
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
          animate={{ scale: pressing ? 0.97 : approved ? 1 : 1 }}
          transition={{ duration: 0.15, ease: "easeInOut" }}
        >
          <span className="hc-story-approve-mark" aria-hidden="true">
            <AnimatePresence mode="wait" initial={false}>
              {approved ? (
                <motion.span
                  key="approved-check"
                  className="hc-story-approve-check"
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ duration: 0.34, ease: STORY_EASE }}
                >
                  <Check size={15} strokeWidth={3} />
                </motion.span>
              ) : (
                <motion.span
                  key="pending-shield"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <ShieldCheck size={15} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          {approved ? "Campaign approved" : "Approve campaign"}
          {pressing ? <StoryCursor pressed /> : null}
        </motion.strong>

        <AnimatePresence>
          {approved ? (
            <motion.span
              className="hc-story-live-toast"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.4, ease: STORY_EASE, delay: 0.18 }}
            >
              Campaign is live
            </motion.span>
          ) : null}
        </AnimatePresence>
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
    <motion.div
      className="hc-process-layout"
      ref={sectionRef}
      variants={SECTION_RISE}
      initial="hidden"
      whileInView="shown"
      viewport={SECTION_IN_VIEW}
      transition={{ duration: 0.6, ease: STORY_EASE }}
    >
      <motion.div className="hc-process-copy" variants={COPY_CASCADE}>
        <motion.small className="hc-process-eyebrow" variants={COPY_ITEM}>Blockwise Ad Studio</motion.small>
        <motion.h2 variants={COPY_ITEM}>Create real estate ads for Facebook &amp; Instagram.</motion.h2>

        <motion.div className="hc-process-steps" aria-label="How Blockwise works" variants={COPY_ITEM}>
          {PROCESS_STEPS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={activeStep === index}
              onClick={() => selectStep(index)}
            >
              <span className="hc-process-step-mark" aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </motion.div>

        <motion.div className="hc-process-actions" variants={COPY_ITEM}>
          <a className="hc-button hc-button--primary" href="#trial">
            Start free trial
            <ArrowRight aria-hidden="true" size={17} />
          </a>
          <small className="hc-process-note">Free 14-day trial · No card required · Cancel anytime</small>
        </motion.div>
      </motion.div>

      <motion.div
        className="hc-process-demo"
        data-scene={scene}
        aria-label="Animated example of creating and approving an ad"
        variants={DEMO_RISE}
      >
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
        <div className="hc-process-demo-caption">
          <small>Preview · Choose → Customise → Review</small>
        </div>
      </motion.div>
    </motion.div>
  );
}
