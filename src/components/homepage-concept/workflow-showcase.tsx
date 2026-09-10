"use client";

import {
  ArrowRight,
  Check,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Share2,
  ShieldCheck,
  ThumbsUp,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";

import "./workflow-showcase.css";

/* ------------------------------------------------------------------ *
 * Story data
 * ------------------------------------------------------------------ */

const PROCESS_STEPS = [
  { label: "Choose", hint: "Pick a ready-made template" },
  { label: "Customise", hint: "Change the wording and image" },
  { label: "Review", hint: "Set the budget and go live" },
] as const;

/** The template the story picks. Declared explicitly so it never depends on
 *  AD_EXAMPLES ordering. */
const STORY_TEMPLATE = {
  id: "suburb-guide",
  label: "Suburb guide",
  image: "/home/subiaco-townhouse.webp",
} as const;

/** Exactly four cards, each a distinct creative. Index 1 is the story card. */
const TEMPLATE_CARDS = [
  { id: AD_EXAMPLES[0].id, label: AD_EXAMPLES[0].label, image: AD_EXAMPLES[0].image },
  STORY_TEMPLATE,
  { id: AD_EXAMPLES[2].id, label: AD_EXAMPLES[2].label, image: AD_EXAMPLES[2].image },
  { id: AD_EXAMPLES[3].id, label: AD_EXAMPLES[3].label, image: AD_EXAMPLES[3].image },
] as const;

const SELECTED_CARD_INDEX = 1;

const STORY_AD = {
  account: "West Coast Home Co",
  avatar: "WCH",
  domain: "WESTCOASTHOME.CO",
  linkTitle: "Get the suburb property guide",
  baseCopy: "A better way to spend summer starts at home.",
  addedCopy: " Explore the new suburb guide.",
  startingOverlay: "YOUR NEXT HOME",
  editedOverlay: "YOUR SUBIACO HOME",
} as const;

const REVIEW_ROWS = [
  ["Audience", "Mt Lawley +15 km"],
  ["Budget", "$20 / day"],
  ["Duration", "14 days"],
] as const;

/* ------------------------------------------------------------------ *
 * Timeline
 *
 * Six cues, one auto pass, then it stops on cue 5 and the step buttons
 * take over. Total pass = 7300ms. A visible transport control satisfies
 * WCAG 2.2 SC 2.2.2 while the pass is running.
 * ------------------------------------------------------------------ */

const CUE_COUNT = 6;
const LAST_CUE = CUE_COUNT - 1;
const CUE_DURATIONS = [1200, 1500, 1600, 1500, 1500] as const;
const CUE_TO_STEP = [0, 0, 1, 1, 2, 2] as const;
const STEP_START_CUE = [0, 2, 4] as const;
const STEP_END_CUE = [1, 3, 5] as const;
const SCENE_NAME = ["browse", "edit", "review"] as const;

const STEP_STATUS = [
  "Step 1 of 3. Choose a template.",
  "Step 2 of 3. Customise the ad.",
  "Step 3 of 3. Review the campaign and go live.",
] as const;

const TYPE_SPEED_COPY_MS = 26;
const TYPE_SPEED_OVERLAY_MS = 46;

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;

/** Panels are never unmounted, so there is no AnimatePresence and no key
 *  contract to get wrong. The outgoing panel holds full opacity until the
 *  incoming one has covered it, which stops the crossfade dipping to the
 *  background. */
const PANEL_ENTER = { duration: 0.3, ease: EASE_OUT } as const;
const PANEL_EXIT = { duration: 0.22, ease: EASE_IN, delay: 0.12 } as const;

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
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
} as const;
const DEMO_RISE = {
  hidden: { opacity: 0, scale: 0.97, y: 14 },
  shown: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.7, ease: EASE_OUT, delay: 0.12 } },
} as const;

/* ------------------------------------------------------------------ *
 * Typewriter
 * ------------------------------------------------------------------ */

/** Returns how many characters of `target` are revealed. The caret is
 *  rendered after the revealed slice by the caller, so it follows the text
 *  instead of sitting at the end of the line. */
function useTypedLength(target: string, typing: boolean, complete: boolean, speedMs: number) {
  const [revealed, setRevealed] = useState(complete ? target.length : 0);

  useEffect(() => {
    if (!typing) {
      setRevealed(complete ? target.length : 0);
      return;
    }
    setRevealed(0);
    let index = 0;
    const id = window.setInterval(() => {
      index += 1;
      setRevealed(index);
      if (index >= target.length) window.clearInterval(id);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [target, typing, complete, speedMs]);

  return revealed;
}

function Caret() {
  return <span className="hc-studio-caret" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ *
 * The ad card. Mounted once for the whole story and never replaced.
 * ------------------------------------------------------------------ */

function AdCard({
  cue,
  copyText,
  overlayText,
  typingCopy,
  typingOverlay,
}: {
  cue: number;
  copyText: string;
  overlayText: string;
  typingCopy: boolean;
  typingOverlay: boolean;
}) {
  const hasTemplate = cue >= 1;
  const isLive = cue >= LAST_CUE;

  return (
    <div className="hc-studio-ad-slot">
      <motion.div
        className="hc-studio-ad-empty"
        animate={{ opacity: hasTemplate ? 0 : 1 }}
        transition={hasTemplate ? PANEL_EXIT : PANEL_ENTER}
      >
        <span>Your ad previews here</span>
      </motion.div>

      <motion.article
        className="hc-meta-ad hc-meta-feed hc-studio-ad"
        animate={{ opacity: hasTemplate ? 1 : 0, scale: hasTemplate ? 1 : 0.97 }}
        transition={hasTemplate ? PANEL_ENTER : PANEL_EXIT}
      >
        <header className="hc-meta-feed-head">
          <span className="hc-meta-avatar" aria-hidden="true">{STORY_AD.avatar}</span>
          <span>
            <strong>{STORY_AD.account}</strong>
            <small>Sponsored <Globe2 aria-hidden="true" size={9} /></small>
          </span>
          <MoreHorizontal aria-hidden="true" size={16} />
        </header>

        <p className={`hc-meta-feed-copy${typingCopy ? " is-editing" : ""}`}>
          {copyText}
          {typingCopy ? <Caret /> : null}
        </p>

        <div className="hc-studio-ad-image">
          <img src={withBasePath(STORY_TEMPLATE.image)} alt="" width="1080" height="1350" />
          <span className="hc-studio-ad-shade" aria-hidden="true" />
          <span className={`hc-studio-ad-overlay${typingOverlay ? " is-editing" : ""}`}>
            {overlayText}
            {typingOverlay ? <Caret /> : null}
          </span>
          <motion.span
            className="hc-studio-live-pill"
            animate={{ opacity: isLive ? 1 : 0, y: isLive ? 0 : 6 }}
            transition={isLive ? { ...PANEL_ENTER, delay: 0.2 } : { duration: 0.15 }}
          >
            <i aria-hidden="true" /> Live
          </motion.span>
        </div>

        <div className="hc-meta-link-preview">
          <span><small>{STORY_AD.domain}</small><strong>{STORY_AD.linkTitle}</strong></span>
          <b>Learn more</b>
        </div>

        <div className="hc-meta-actions" aria-hidden="true">
          <span><ThumbsUp size={12} />Like</span>
          <span><MessageCircle size={12} />Comment</span>
          <span><Share2 size={12} />Share</span>
        </div>
      </motion.article>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Control panels. All three stay mounted; only opacity changes.
 * ------------------------------------------------------------------ */

function Panel({
  name,
  active,
  eyebrow,
  title,
  children,
}: {
  name: string;
  active: boolean;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="hc-studio-panel"
      data-panel={name}
      animate={{ opacity: active ? 1 : 0 }}
      transition={active ? PANEL_ENTER : PANEL_EXIT}
      style={{ pointerEvents: "none", zIndex: active ? 2 : 1 }}
    >
      <div className="hc-studio-panel-head">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      {children}
    </motion.div>
  );
}

function ChoosePanel({ cue, active }: { cue: number; active: boolean }) {
  const picked = cue >= 1;

  return (
    <Panel
      name="choose"
      active={active}
      eyebrow="Ready-made ads"
      title={picked ? "Template selected" : "Pick a starting point"}
    >
      <div className="hc-studio-template-grid">
        {TEMPLATE_CARDS.map((card, index) => {
          const selected = picked && index === SELECTED_CARD_INDEX;
          return (
            <motion.div
              className={`hc-studio-template-card${selected ? " is-selected" : ""}`}
              key={card.id}
              animate={{ opacity: !picked || selected ? 1 : 0.45 }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
            >
              <span className="hc-studio-template-thumb">
                <img src={withBasePath(card.image)} alt="" width="1080" height="1350" />
                <motion.span
                  className="hc-studio-template-check"
                  animate={{ opacity: selected ? 1 : 0, scale: selected ? 1 : 0.6 }}
                  transition={{ duration: 0.28, ease: EASE_OUT }}
                >
                  <Check aria-hidden="true" size={12} strokeWidth={3} />
                </motion.span>
              </span>
              <small>{card.label}</small>
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}

function CustomisePanel({
  cue,
  active,
  copyText,
  overlayText,
  typingCopy,
  typingOverlay,
}: {
  cue: number;
  active: boolean;
  copyText: string;
  overlayText: string;
  typingCopy: boolean;
  typingOverlay: boolean;
}) {
  return (
    <Panel name="customise" active={active} eyebrow="Customise" title="Make it yours">
      <div className="hc-studio-fields">
        <label className={typingCopy ? "is-active" : ""}>
          <span>Post copy</span>
          <strong>{copyText}{typingCopy ? <Caret /> : null}</strong>
        </label>
        <label className={typingOverlay ? "is-active" : ""}>
          <span>Text on creative</span>
          <strong>{overlayText}{typingOverlay ? <Caret /> : null}</strong>
        </label>
      </div>
      <p className="hc-studio-panel-note">
        {cue >= 3 ? "Wording updated on the post and the image." : "Edit the wording, the preview updates as you type."}
      </p>
    </Panel>
  );
}

function ReviewPanel({ cue, active }: { cue: number; active: boolean }) {
  const approved = cue >= LAST_CUE;

  return (
    <Panel name="review" active={active} eyebrow="Review" title="Check and go live">
      <dl className="hc-studio-review-rows">
        {REVIEW_ROWS.map(([label, value], index) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <motion.span
                animate={{ opacity: active ? 1 : 0, y: active ? 0 : 6 }}
                transition={{ duration: 0.34, ease: EASE_OUT, delay: active ? 0.1 + index * 0.11 : 0 }}
              >
                {value}
              </motion.span>
            </dd>
          </div>
        ))}
      </dl>

      <motion.div
        className={`hc-studio-approve${approved ? " is-approved" : ""}`}
        animate={{ scale: approved ? 1 : 1 }}
        transition={{ duration: 0.18, ease: "easeInOut" }}
      >
        <span className="hc-studio-approve-mark" aria-hidden="true">
          {approved ? <Check size={14} strokeWidth={3} /> : <ShieldCheck size={14} />}
        </span>
        {approved ? "Campaign approved" : "Approve campaign"}
      </motion.div>

      <motion.p
        className="hc-studio-live-note"
        animate={{ opacity: approved ? 1 : 0, y: approved ? 0 : 6 }}
        transition={approved ? { duration: 0.4, ease: EASE_OUT, delay: 0.24 } : { duration: 0.15 }}
      >
        Campaign is live on Facebook and Instagram.
      </motion.p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Section
 * ------------------------------------------------------------------ */

export function WorkflowShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const hasAutoStarted = useRef(false);
  const reduceMotion = Boolean(useReducedMotion());

  const [cue, setCue] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  const step = CUE_TO_STEP[cue];
  const finished = cue >= LAST_CUE;

  const typingCopy = playing && cue === 2;
  const typingOverlay = playing && cue === 3;

  const typedCopy = useTypedLength(STORY_AD.addedCopy, typingCopy, cue >= 3, TYPE_SPEED_COPY_MS);
  const typedOverlay = useTypedLength(STORY_AD.editedOverlay, typingOverlay, cue >= 4, TYPE_SPEED_OVERLAY_MS);

  const copyText =
    cue < 2
      ? STORY_AD.baseCopy
      : cue === 2
        ? STORY_AD.baseCopy + STORY_AD.addedCopy.slice(0, typedCopy)
        : STORY_AD.baseCopy + STORY_AD.addedCopy;

  const overlayText =
    cue < 3
      ? STORY_AD.startingOverlay
      : cue === 3
        ? STORY_AD.editedOverlay.slice(0, typedOverlay)
        : STORY_AD.editedOverlay;

  /* Start the single pass the first time the section is properly in view. */
  useEffect(() => {
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    const node = sectionRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && !reduceMotion && !hasAutoStarted.current) {
          hasAutoStarted.current = true;
          setCue(0);
          setPlaying(true);
        }
      },
      { threshold: 0.35 },
    );

    syncVisibility();
    if (node) observer.observe(node);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [reduceMotion]);

  /* Reduced motion gets the finished state with no timers at all. */
  useEffect(() => {
    if (reduceMotion) {
      setPlaying(false);
      setCue(LAST_CUE);
    }
  }, [reduceMotion]);

  /* One cue at a time. Stops for good at LAST_CUE, so nothing loops. */
  useEffect(() => {
    if (!playing || !inView || !pageVisible || reduceMotion) return;
    if (cue >= LAST_CUE) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setCue((current) => current + 1), CUE_DURATIONS[cue]);
    return () => window.clearTimeout(timer);
  }, [cue, inView, pageVisible, playing, reduceMotion]);

  function selectStep(nextStep: number) {
    if (reduceMotion) {
      setCue(STEP_END_CUE[nextStep]);
      return;
    }
    hasAutoStarted.current = true;
    setCue(STEP_START_CUE[nextStep]);
    setPlaying(true);
  }

  function toggleTransport() {
    if (finished) {
      setCue(0);
      setPlaying(true);
      return;
    }
    setPlaying((current) => !current);
  }

  const transportLabel = finished ? "Replay the walkthrough" : playing ? "Pause the walkthrough" : "Play the walkthrough";
  const TransportIcon = finished ? RotateCcw : playing ? Pause : Play;

  return (
    <motion.div
      className="hc-process-layout"
      ref={sectionRef}
      variants={SECTION_RISE}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "-12%" }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
    >
      <motion.div className="hc-process-copy" variants={COPY_CASCADE}>
        <motion.small className="hc-process-eyebrow" variants={COPY_ITEM}>Blockwise Ad Studio</motion.small>
        <motion.h2 variants={COPY_ITEM}>Create real estate ads for Facebook &amp; Instagram.</motion.h2>

        <motion.div className="hc-process-steps" role="group" aria-label="How Blockwise works" variants={COPY_ITEM}>
          {PROCESS_STEPS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={step === index}
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
        data-scene={SCENE_NAME[step]}
        variants={DEMO_RISE}
      >
        <div className="hc-process-demo-topbar">
          <span><i aria-hidden="true" /> Blockwise Ad Studio</span>
          <ol aria-hidden="true">
            {PROCESS_STEPS.map((item, index) => (
              <li className={step === index ? "is-active" : ""} key={item.label}>{item.label}</li>
            ))}
          </ol>
        </div>

        <p className="hc-sr-only" aria-live="polite">{STEP_STATUS[step]}</p>

        <div className="hc-studio" aria-hidden="true">
          <AdCard
            cue={cue}
            copyText={copyText}
            overlayText={overlayText}
            typingCopy={typingCopy}
            typingOverlay={typingOverlay}
          />

          <div className="hc-studio-panels">
            <ChoosePanel cue={cue} active={step === 0} />
            <CustomisePanel
              cue={cue}
              active={step === 1}
              copyText={copyText}
              overlayText={overlayText}
              typingCopy={typingCopy}
              typingOverlay={typingOverlay}
            />
            <ReviewPanel cue={cue} active={step === 2} />
          </div>
        </div>

        {reduceMotion ? null : (
          <div className="hc-studio-transport">
            <button type="button" onClick={toggleTransport} aria-label={transportLabel}>
              <TransportIcon aria-hidden="true" size={13} />
              {finished ? "Replay" : playing ? "Pause" : "Play"}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
