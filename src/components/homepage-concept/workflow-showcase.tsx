"use client";

import {
  ArrowRight,
  Check,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Share2,
  ShieldCheck,
  ThumbsUp,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AD_EXAMPLES, AD_LIBRARY, withBasePath } from "@/lib/homepage-concept/content";

import "./workflow-showcase.css";

const PROCESS_STEPS = [
  { label: "Choose", hint: "Pick a ready-made template" },
  { label: "Customise", hint: "Change the wording and image" },
  { label: "Review", hint: "Set the budget and go live" },
] as const;

/**
 * Nine phases: 0-3 choose an ad, 4-6 write it, 7-8 review it.
 * The selector visits these library positions in order and settles on the last.
 */
const LIBRARY_SEQUENCE = [0, 1, 2, 3] as const;
const SELECTED_PHASE = 3;
const STORY_PHASE_DELAYS = [900, 880, 880, 1300, 1500, 1600, 1400, 1500, 1800] as const;
const STORY_STEP_PHASES = [0, 4, 7] as const;
const STORY_PHASE_TO_STEP = [0, 0, 0, 0, 1, 1, 1, 2, 2] as const;
const STORY_STATUS = [
  "Choosing an ad. Browsing ready-made ads.",
  "Choosing an ad.",
  "Choosing an ad.",
  "Ad selected.",
  "Customising the ad. The text fields are empty.",
  "Writing the post copy.",
  "Adding a link title.",
  "Review campaign.",
  "Campaign approved.",
] as const;

/** The library entry the demo selects. It owns the real post copy and link title. */
const SELECTED_AD = { ...AD_EXAMPLES[0], image: AD_LIBRARY[LIBRARY_SEQUENCE[LIBRARY_SEQUENCE.length - 1]].image };
const STORY_AD = {
  ...SELECTED_AD,
  account: "Alex Morgan Property",
  avatar: "AM",
  domain: "ALEXMORGAN.COM.AU",
} as const;

const STORY_EASE = [0.16, 1, 0.3, 1] as const;
const STORY_MOVE = { duration: 0.42, ease: STORY_EASE };
const STORY_ENTER = { duration: 0.34, ease: STORY_EASE };
const STORY_EXIT = { duration: 0.22, ease: [0.32, 0, 0.67, 0] as const };

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

/** True below the phone breakpoint, where the library shows fewer ads. */
function useNarrowLibrary() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 600px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

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

/** The Meta feed frame, reused by the editor and the review scene. */
function StoryAd({ phase, review = false }: { phase: number; review?: boolean }) {
  const copyWritten = phase >= 5;
  const linkWritten = phase >= 6;

  return (
    <motion.article
      layoutId="story-ad"
      className={`hc-meta-ad hc-meta-feed hc-story-ad${review ? " is-review" : ""}`}
      transition={STORY_MOVE}
    >
      <header className="hc-meta-feed-head">
        <span className="hc-meta-avatar" aria-hidden="true">{STORY_AD.avatar}</span>
        <span><strong>{STORY_AD.account}</strong><small>Sponsored <Globe2 aria-hidden="true" size={9} /></small></span>
        <MoreHorizontal aria-hidden="true" size={16} />
      </header>
      <motion.p
        className={`hc-meta-feed-copy${phase === 5 ? " is-editing" : ""}`}
        key={copyWritten ? "written" : "empty"}
        initial={{ opacity: 0.4, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={STORY_ENTER}
      >
        {copyWritten ? STORY_AD.postCopy : <span className="hc-story-placeholder">Your post copy appears here</span>}
      </motion.p>
      <motion.div layoutId="story-ad-creative" className="hc-story-ad-image" transition={STORY_MOVE}>
        <img src={withBasePath(STORY_AD.image)} alt="" width="1080" height="1350" />
      </motion.div>
      <div className="hc-meta-link-preview">
        <span>
          <small>{STORY_AD.domain}</small>
          <strong>{linkWritten ? STORY_AD.linkTitle : <span className="hc-story-placeholder">Your link title</span>}</strong>
        </span>
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

/**
 * Screen 1. The ready-made ad library with one selector frame that glides
 * between ads, then settles on the chosen one.
 */
function LibraryScene({ phase, narrow }: { phase: number; narrow: boolean }) {
  const cards = narrow ? AD_LIBRARY.slice(0, 4) : AD_LIBRARY;
  const position = Math.min(phase, LIBRARY_SEQUENCE.length - 1);
  const activeIndex = LIBRARY_SEQUENCE[position];
  const selected = phase >= SELECTED_PHASE;

  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [frame, setFrame] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    const card = cardRefs.current[activeIndex];
    if (!grid || !card) return;
    const measure = () => {
      setFrame({
        x: card.offsetLeft - 5,
        y: card.offsetTop - 5,
        width: card.offsetWidth + 10,
        height: card.offsetHeight + 10,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [activeIndex, cards.length]);

  return (
    <motion.div
      key="library"
      className="hc-story-scene hc-story-library"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ...STORY_EXIT, opacity: { duration: 0.2 } }}
    >
      <div className="hc-story-scene-heading">
        <strong>{selected ? "Ad selected" : "Choose a starting point"}</strong>
      </div>

      <div className="hc-library-grid" ref={gridRef}>
        {frame ? (
          <motion.span
            className={`hc-library-selector${selected ? " is-selected" : ""}`}
            aria-hidden="true"
            initial={false}
            animate={{ x: frame.x, y: frame.y, width: frame.width, height: frame.height }}
            transition={STORY_MOVE}
          />
        ) : null}

        {cards.map((ad, index) => {
          const active = index === activeIndex;
          const chosen = selected && active;
          return (
            <motion.div
              key={ad.id}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              className={`hc-library-card${active ? " is-active" : ""}${chosen ? " is-selected" : ""}`}
              animate={{ opacity: active ? 1 : 0.62 }}
              transition={STORY_MOVE}
            >
              <motion.div
                layoutId={chosen ? "story-ad-creative" : undefined}
                className="hc-library-card-image"
                transition={STORY_MOVE}
              >
                <img src={withBasePath(ad.image)} alt="" width="1080" height="1350" />
              </motion.div>
              <AnimatePresence>
                {chosen ? (
                  <motion.span
                    className="hc-library-check"
                    initial={{ opacity: 0, y: 6, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={STORY_ENTER}
                  >
                    <Check aria-hidden="true" size={13} strokeWidth={3} />
                    Selected
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/** Screen 2. The chosen ad on the left, empty text fields on the right. */
function EditorScene({ phase }: { phase: number }) {
  const copyWritten = phase >= 5;
  const linkWritten = phase >= 6;

  return (
    <motion.div
      key="editor"
      className="hc-story-scene hc-story-editor"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={STORY_ENTER}
    >
      <div className="hc-story-ad-workspace">
        <StoryAd phase={phase} />
      </div>

      <div className="hc-story-edit-panel">
        <h3>Make it yours</h3>
        <p className="hc-story-edit-hint">Write the text, then approve the campaign.</p>

        <label className={`hc-field${phase === 5 ? " is-active" : ""}`} data-empty={copyWritten ? undefined : "true"}>
          <span>Post copy</span>
          <strong>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copyWritten ? "copy-written" : "copy-empty"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: STORY_EASE }}
              >
                {copyWritten ? STORY_AD.postCopy : "Write your post copy"}
              </motion.span>
            </AnimatePresence>
            {phase === 5 ? <span className="hc-story-caret" /> : null}
          </strong>
        </label>

        <label className={`hc-field${phase === 6 ? " is-active" : ""}`} data-empty={linkWritten ? undefined : "true"}>
          <span>Link title</span>
          <strong>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={linkWritten ? "link-written" : "link-empty"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: STORY_EASE }}
              >
                {linkWritten ? STORY_AD.linkTitle : "Add a link title"}
              </motion.span>
            </AnimatePresence>
            {phase === 6 ? <span className="hc-story-caret" /> : null}
          </strong>
        </label>
      </div>
    </motion.div>
  );
}

function ReviewScene({ phase }: { phase: number }) {
  const valuesFilled = phase >= 7;
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

      <motion.div
        className="hc-story-review-panel"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...STORY_ENTER, delay: 0.14 }}
      >
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
  const narrow = useNarrowLibrary();
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const activeStep = STORY_PHASE_TO_STEP[phase];
  const finished = phase >= STORY_STATUS.length - 1;

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

  /* Reduced motion gets the finished state with no timers at all. */
  useEffect(() => {
    if (reduceMotion) {
      setPhase(STORY_STATUS.length - 1);
      setPlaying(false);
    }
  }, [reduceMotion]);

  /* One phase at a time. Stops for good on the approved frame, so nothing loops. */
  useEffect(() => {
    if (!playing || !inView || !pageVisible || reduceMotion) return;
    if (phase >= STORY_STATUS.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setPhase((current) => Math.min(current + 1, STORY_STATUS.length - 1)),
      STORY_PHASE_DELAYS[phase],
    );
    return () => window.clearTimeout(timer);
  }, [inView, pageVisible, phase, playing, reduceMotion]);

  function selectStep(nextStep: number) {
    hasStarted.current = true;
    setPhase(STORY_STEP_PHASES[nextStep]);
    setPlaying(!reduceMotion && nextStep < PROCESS_STEPS.length - 1);
  }

  function toggleTransport() {
    hasStarted.current = true;
    if (finished) {
      setPhase(0);
      setPlaying(true);
      return;
    }
    setPlaying((current) => !current);
  }

  const scene = phase <= SELECTED_PHASE ? "browse" : phase <= 6 ? "edit" : "review";

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
        aria-label="Animated example of choosing an ad and approving a campaign"
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
              {scene === "browse" ? <LibraryScene phase={phase} narrow={narrow} /> : null}
              {scene === "edit" ? <EditorScene phase={phase} /> : null}
              {scene === "review" ? <ReviewScene phase={phase} /> : null}
            </AnimatePresence>
          </div>
        </LayoutGroup>

        <div className="hc-process-demo-transport">
          {reduceMotion ? (
            <small>Animation off. Your device prefers reduced motion.</small>
          ) : (
            <button type="button" onClick={toggleTransport} aria-label={finished ? "Replay the demo" : playing ? "Pause the demo" : "Play the demo"}>
              {finished ? <RotateCcw aria-hidden="true" size={14} /> : playing ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
              {finished ? "Replay" : playing ? "Pause" : "Play"}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
