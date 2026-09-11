"use client";

import {
  ArrowRight,
  Check,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  Share2,
  ShieldCheck,
  ThumbsUp,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { creativeImageSrcSet } from "@/lib/homepage-concept/creative-image";
import { AD_EXAMPLES, AD_LIBRARY, withBasePath } from "@/lib/homepage-concept/content";

import "./workflow-showcase.css";

const PROCESS_STEPS = [
  { label: "Choose", hint: "Pick a ready-made ad from the library" },
  { label: "Customise", hint: "Write the post copy and link title" },
  { label: "Review", hint: "Check the budget and approve it" },
] as const;

/**
 * Nine phases: 0-3 choose an ad, 4-6 write it, 7-8 review it.
 * The selector visits these library positions in order and settles on the last.
 */
const LIBRARY_SEQUENCE = [0, 1, 2, 3] as const;
const SELECTED_PHASE = 3;
/**
 * How long each phase holds. `null` means the phase waits for the visitor to
 * watch the text being written, so typing sets the pace rather than a timer.
 */
const STORY_HOLDS: ReadonlyArray<number | null> = [760, 700, 700, 1000, 620, null, null, 1750, 2100];
/* The button is pressed here, and the ad is live by the time it lands. */
const PRESS_PHASE = STORY_HOLDS.length - 1;
const STORY_STEP_PHASES = [0, 4, 7] as const;
const STORY_PHASE_TO_STEP = [0, 0, 0, 0, 1, 1, 1, 2, 2] as const;
const STORY_STATUS = [
  "Choosing an ad. Browsing ready-made ads.",
  "Choosing an ad.",
  "Choosing an ad.",
  "Ad selected.",
  "Customising the ad. Write the post copy.",
  "Writing the post copy.",
  "Adding a link title.",
  "Review campaign. Approving it makes the ad live.",
  "Campaign approved. The ad is live.",
] as const;

/** Milliseconds per character. The field and the ad advance on the same count. */
const TYPE_SPEED_COPY = 24;
const TYPE_SPEED_LINK = 40;

/** The library entry the demo selects. It owns the real post copy and link title. */
const SELECTED_AD = { ...AD_EXAMPLES[0], image: AD_LIBRARY[LIBRARY_SEQUENCE[LIBRARY_SEQUENCE.length - 1]].image };
const STORY_AD = {
  ...SELECTED_AD,
  account: "Alex Morgan Property",
  avatar: "AM",
  domain: "ALEXMORGAN.COM.AU",
} as const;

const STORY_EASE = [0.16, 1, 0.3, 1] as const;
const STORY_MOVE = { duration: 0.5, ease: STORY_EASE };
const STORY_ENTER = { duration: 0.38, ease: STORY_EASE };

/* Under reduced motion the section still fades in; only the movement is dropped.
   Fades are explicitly not "motion" under WCAG 2.3.3, so removing them as well
   would make the page feel broken rather than calm. */
const REDUCED_FADE_IN = { duration: 0.28, ease: "linear" } as const;

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

/**
 * Types `text` one character at a time and reports how many are showing. The
 * same count drives the text field and the ad preview, so both are written
 * together. Nothing runs until `run` turns true, and `run` turning false again
 * clears the text, which is what stepping backwards needs. `at` is the phase
 * the run started on and `past` is the phase that finishes it, so a step change
 * mid-write hands over instead of starting the same text again.
 */
function useTypewriter({ run, text, at, past, speed, onComplete }: {
  run: boolean;
  text: string;
  at: number;
  past: number;
  speed: number;
  onComplete: (phase: number) => void;
}) {
  const [chars, setChars] = useState(0);
  const timerRef = useRef<number | null>(null);
  const settleRef = useRef(onComplete);
  settleRef.current = onComplete;

  useEffect(() => {
    if (!run || !text) {
      setChars(0);
      return;
    }
    /* Picking up where another scene left off: show the text, do not retype it. */
    if (at !== past) {
      setChars(text.length);
      return;
    }
    setChars(0);
    let index = 0;
    const schedule = () => {
      /* Bounded randomness, never a fixed period: a stall on every nth character
         reads as the animation stuttering, while uneven gaps read as a hand. */
      const jitter = speed * 0.45;
      const pause = Math.random() < 0.18 ? speed * 0.7 : 0;
      timerRef.current = window.setTimeout(() => {
        index += 1;
        setChars(index);
        if (index >= text.length) {
          timerRef.current = null;
          settleRef.current(past);
          return;
        }
        schedule();
      }, speed + (Math.random() * 2 - 1) * jitter + pause);
    };
    schedule();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [run, text, at, past, speed]);

  const reset = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setChars(0);
  }, []);

  /* Derived, not stored: nothing can drift out of step with the count. */
  const typing = run && at === past && chars < text.length;

  return { chars, typing, reset };
}

/** The Meta feed frame, reused by the editor and the review scene. */
function StoryAd({
  phase,
  copyChars,
  linkChars,
  copyTyping,
  linkTyping,
  morph = true,
  approved = false,
  review = false,
}: {
  phase: number;
  copyChars: number;
  linkChars: number;
  copyTyping: boolean;
  linkTyping: boolean;
  morph?: boolean;
  approved?: boolean;
  review?: boolean;
}) {
  const writingCopy = phase === 5;
  const writingLink = phase === 6;

  return (
    <motion.article
      layoutId={morph ? "story-ad" : undefined}
      className={`hc-meta-ad hc-meta-feed hc-story-ad${review ? " is-review" : ""}`}
      transition={STORY_MOVE}
    >
      <header className="hc-meta-feed-head">
        <span className="hc-meta-avatar" aria-hidden="true">{STORY_AD.avatar}</span>
        <span><strong>{STORY_AD.account}</strong><small>Sponsored <Globe2 aria-hidden="true" size={9} /></small></span>
        <MoreHorizontal aria-hidden="true" size={16} />
      </header>
      <p className={`hc-meta-feed-copy${writingCopy ? " is-editing" : ""}`}>
        {copyChars > 0 ? STORY_AD.postCopy.slice(0, copyChars) : <span className="hc-story-placeholder">Your post copy appears here</span>}
        {writingCopy && copyTyping ? <span className="hc-story-caret" /> : null}
      </p>
      <motion.div
        layoutId={morph ? "story-ad-creative" : undefined}
        className="hc-story-ad-image"
        transition={STORY_MOVE}
      >
        <img
          src={withBasePath(STORY_AD.image)}
          srcSet={creativeImageSrcSet(STORY_AD.image)}
          alt=""
          width="1080"
          height="1350"
          sizes="(min-width: 1024px) 320px, (min-width: 601px) 300px, 78vw"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        {/* The creative carries no text of its own, so the headline the visitor
            writes is set straight onto the image, the way a finished ad sets it.
            A scrim under it keeps the type legible without reading as a panel. */}
        <span className={`hc-story-ad-headline${writingLink ? " is-writing" : ""}`}>
          <i className="hc-story-ad-rule" aria-hidden="true" />
          <span className="hc-story-ad-headline-text">
            {linkChars > 0
              ? STORY_AD.adTitle.slice(0, linkChars)
              : <i className="hc-story-ad-placeholder">{STORY_AD.adTitle}</i>}
            {writingLink && linkTyping ? <span className="hc-story-caret" /> : null}
          </span>
        </span>
        <AnimatePresence>
          {approved ? (
            <motion.span
              className="hc-story-ad-live"
              initial={{ opacity: 0, scale: 0.82, y: -5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.36, ease: STORY_EASE, delay: 0.1 }}
            >
              <i aria-hidden="true" />
              Live
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.div>
      <div className="hc-meta-link-preview">
        <span>
          <small>{STORY_AD.domain}</small>
          <strong>
            {linkChars > 0 ? STORY_AD.linkTitle.slice(0, linkChars) : <span className="hc-story-placeholder">Your link title</span>}
            {writingLink && linkTyping ? <span className="hc-story-caret" /> : null}
          </strong>
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
 * Screen 1. One row of ready-made ads. A single selector frame glides along the
 * row, the row itself slides so the chosen ad stays centred, then the frame
 * locks on it.
 */
function LibraryScene({ phase, narrow, active }: { phase: number; narrow: boolean; active: boolean }) {
  const cards = narrow ? AD_LIBRARY.slice(0, 4) : AD_LIBRARY;
  const position = Math.min(phase, LIBRARY_SEQUENCE.length - 1);
  const activeIndex = LIBRARY_SEQUENCE[position];
  const selected = phase >= SELECTED_PHASE;

  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [frame, setFrame] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const view = windowRef.current;
    const track = trackRef.current;
    const card = cardRefs.current[activeIndex];
    if (!view || !track || !card) return;

    const measure = () => {
      // The selector hugs the active card, inside the track so the two move together.
      setFrame({
        x: card.offsetLeft - 5,
        y: card.offsetTop - 5,
        width: card.offsetWidth + 10,
        height: card.offsetHeight + 10,
      });
      // Centre the active card, and never scroll past either end of the row.
      const centred = card.offsetLeft + card.offsetWidth / 2 - view.clientWidth / 2;
      const limit = Math.max(0, track.scrollWidth - view.clientWidth);
      setShift(Math.min(Math.max(centred, 0), limit));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeIndex, cards.length]);

  return (
    <div
      className={`hc-story-scene hc-story-library${active ? " is-active" : ""}`}
      aria-hidden={active ? undefined : "true"}
    >
      <div className="hc-story-scene-heading">
        <strong>{selected ? "Ad selected" : "Choose a starting point"}</strong>
      </div>

      <div className="hc-library-window" ref={windowRef}>
        <motion.div
          className="hc-library-track"
          ref={trackRef}
          initial={false}
          animate={{ x: -shift }}
          transition={STORY_MOVE}
        >
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
                animate={{ opacity: active ? 1 : 0.6 }}
                transition={STORY_MOVE}
              >
                <motion.div
                  layoutId={chosen ? "story-ad-creative" : undefined}
                  className="hc-library-card-image"
                  transition={STORY_MOVE}
                >
                  <img
                    src={withBasePath(ad.image)}
                    srcSet={creativeImageSrcSet(ad.image)}
                    alt=""
                    width="1080"
                    height="1350"
                    sizes="(min-width: 1024px) 150px, (min-width: 601px) 130px, 34vw"
                    loading="lazy"
                    decoding="async"
                  />
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
        </motion.div>
      </div>
    </div>
  );
}

/** Screen 2. The chosen ad on the left, the text fields being written on the right. */
function EditorScene({
  phase,
  copyChars,
  linkChars,
  copyTyping,
  linkTyping,
  active,
}: {
  phase: number;
  copyChars: number;
  linkChars: number;
  copyTyping: boolean;
  linkTyping: boolean;
  active: boolean;
}) {
  return (
    <div
      className={`hc-story-scene hc-story-editor${active ? " is-active" : ""}`}
      aria-hidden={active ? undefined : "true"}
    >
      <div className="hc-story-ad-workspace">
        <StoryAd
          phase={phase}
          copyChars={copyChars}
          linkChars={linkChars}
          copyTyping={copyTyping}
          linkTyping={linkTyping}
          morph
        />
      </div>

      <div className="hc-story-edit-panel">
        <h3>Make it yours</h3>
        <p className="hc-story-edit-hint">Write the text, then approve the campaign.</p>

        <label className={`hc-field${phase === 5 ? " is-active" : ""}`} data-empty={copyChars === 0 ? "true" : undefined}>
          <span>Post copy</span>
          <strong>
            {copyChars > 0 ? STORY_AD.postCopy.slice(0, copyChars) : "Write your post copy"}
            {phase === 5 && copyTyping ? <span className="hc-story-caret" /> : null}
          </strong>
        </label>

        <label className={`hc-field${phase === 6 ? " is-active" : ""}`} data-empty={linkChars === 0 ? "true" : undefined}>
          <span>Link title</span>
          <strong>
            {linkChars > 0 ? STORY_AD.linkTitle.slice(0, linkChars) : "Add a link title"}
            {phase === 6 && linkTyping ? <span className="hc-story-caret" /> : null}
          </strong>
        </label>
      </div>
    </div>
  );
}

/** The three things the review screen confirms, written a character at a time. */
const REVIEW_FIELDS = [
  ["Audience", "Mt Lawley +15 km"],
  ["Budget", "$20 / day"],
  ["Duration", "14 days"],
] as const;

const REVIEW_ITEM_DELAY = 420;
const REVIEW_ITEM_SPEED = 19;

/**
 * Writes the review values in one after another. Each value keeps its own
 * counter, so the panel fills left to right like the fields on screen two.
 */
function useTypedReview(start: boolean, reduceMotion: boolean) {
  const [counts, setCounts] = useState<number[]>(() => REVIEW_FIELDS.map(() => 0));
  const doneRef = useRef(false);

  useEffect(() => {
    if (!start) {
      setCounts(REVIEW_FIELDS.map(() => 0));
      doneRef.current = false;
      return;
    }
    if (reduceMotion) {
      setCounts(REVIEW_FIELDS.map(([, value]) => value.length));
      doneRef.current = true;
      return;
    }
    const timers: number[] = [];
    const next = REVIEW_FIELDS.map(() => 0);
    setCounts([...next]);
    doneRef.current = false;
    let index = 0;
    const step = () => {
      if (index >= REVIEW_FIELDS.length) return;
      const [label, value] = REVIEW_FIELDS[index];
      let char = 0;
      const tick = () => {
        char += 1;
        next[index] = char;
        setCounts([...next]);
        if (char < value.length) {
          timers.push(window.setTimeout(tick, REVIEW_ITEM_SPEED));
          return;
        }
        index += 1;
        if (index >= REVIEW_FIELDS.length) {
          doneRef.current = true;
          return;
        }
        timers.push(window.setTimeout(step, REVIEW_ITEM_DELAY));
      };
      void label;
      tick();
    };
    timers.push(window.setTimeout(step, 120));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [start, reduceMotion]);

  return counts;
}

function ReviewScene({
  phase,
  copyChars,
  linkChars,
  approved,
  reduceMotion,
  active,
}: {
  phase: number;
  copyChars: number;
  linkChars: number;
  approved: boolean;
  reduceMotion: boolean;
  active: boolean;
}) {
  const pressing = phase === PRESS_PHASE;
  const counts = useTypedReview(phase >= 7, reduceMotion);

  return (
    <div
      className={`hc-story-scene hc-story-review${active ? " is-active" : ""}`}
      aria-hidden={active ? undefined : "true"}
    >
      <motion.div
        className="hc-story-review-preview"
        /* The ad takes the press: one quick lift, then it settles back. Under
           reduced motion it dips in place instead of travelling. */
        animate={
          pressing
            ? reduceMotion
              ? { scale: [1, 0.99, 1] }
              : { scale: [1, 1.035, 0.995, 1], y: [0, -8, 0, 0] }
            : { scale: 1, y: 0 }
        }
        transition={
          pressing
            ? { duration: 0.62, ease: STORY_EASE, times: reduceMotion ? [0, 0.4, 1] : [0, 0.35, 0.75, 1] }
            : STORY_ENTER
        }
      >
        <StoryAd
          phase={phase}
          copyChars={copyChars}
          linkChars={linkChars}
          copyTyping={false}
          linkTyping={false}
          morph={false}
          approved={approved}
          review
        />
      </motion.div>

      <motion.div
        className="hc-story-review-panel"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...STORY_ENTER, delay: 0.14 }}
      >
        <h3>Review campaign</h3>
        <dl>
          {REVIEW_FIELDS.map(([label, value], index) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <span>
                  {value.slice(0, counts[index])}
                  {counts[index] > 0 && counts[index] < value.length ? <span className="hc-story-caret" /> : null}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <motion.strong
          className={`hc-story-approve${approved ? " is-approved" : ""}`}
          animate={pressing ? { scale: [1, 0.94, 1] } : { scale: 1 }}
          transition={{ duration: 0.42, ease: STORY_EASE }}
        >
          <span className="hc-story-approve-mark" aria-hidden="true">
            {approved ? (
              <motion.span
                className="hc-story-approve-check"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.34, ease: STORY_EASE }}
              >
                <Check size={15} strokeWidth={3} />
              </motion.span>
            ) : (
              <motion.span key="pending-shield" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
                <ShieldCheck size={15} />
              </motion.span>
            )}
          </span>
          {approved ? "Campaign approved" : "Approve campaign"}
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
    </div>
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
  const stepsRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  /* Only a phase that is still current may advance the story, so a step change
     can never be overtaken by a timer or a keystroke from the step before it. */
  const nextPhase = useCallback((from: number) => {
    setPhase((current) => {
      if (current !== from) return current;
      if (current >= STORY_STATUS.length - 1) {
        setPlaying(false);
        return current;
      }
      return current + 1;
    });
  }, []);

  const copy = useTypewriter({
    run: phase >= 5,
    text: STORY_AD.postCopy,
    at: phase,
    past: 5,
    speed: TYPE_SPEED_COPY,
    onComplete: nextPhase,
  });
  const link = useTypewriter({
    run: phase >= 6,
    text: STORY_AD.linkTitle,
    at: phase,
    past: 6,
    speed: TYPE_SPEED_LINK,
    onComplete: nextPhase,
  });
  const resetCopy = copy.reset;
  const resetLink = link.reset;

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
      /* A phone viewport is shorter than this section, so 0.3 of it can never
         be on screen there and the story would never start. */
      { threshold: 0.12 },
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

  /**
   * One phase at a time. A phase that writes text waits for the typing to
   * finish, so the copy is always read at a human pace. Reduced motion only
   * shortens the run, so the story still ends on the live frame. Stops for good
   * on the approved frame, so nothing loops.
   */
  useEffect(() => {
    if (!playing || !inView || !pageVisible) return;
    if (phase >= STORY_STATUS.length - 1) {
      setPlaying(false);
      return;
    }
    const hold = STORY_HOLDS[phase];
    if (hold === null) return;
    const timer = window.setTimeout(() => nextPhase(phase), reduceMotion ? 260 : hold);
    return () => window.clearTimeout(timer);
  }, [inView, pageVisible, phase, playing, reduceMotion, nextPhase]);

  /* Slide the pill behind whichever step the story is on. */
  useEffect(() => {
    const wrap = stepsRef.current;
    if (!wrap) return;
    const measure = () => {
      const button = wrap.querySelectorAll("button")[activeStep] as HTMLElement | undefined;
      if (!button) return;
      setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [activeStep]);

  function selectStep(nextStep: number) {
    resetCopy();
    resetLink();
    hasStarted.current = true;
    setPhase(STORY_STEP_PHASES[nextStep]);
    setPlaying(true);
  }

  const scene = phase <= SELECTED_PHASE ? "browse" : phase <= 6 ? "edit" : "review";
  /* How much text each field shows. A later phase is already complete, the
     phase that writes a field counts characters, an earlier one is still empty.
     Stepping back to Choose clears both, so the story starts from nothing. */
  const copyChars = scene === "browse" ? 0 : phase > 5 ? STORY_AD.postCopy.length : phase === 5 ? copy.chars : 0;
  const linkChars = scene === "browse" || phase < 6 ? 0 : phase > 6 ? STORY_AD.linkTitle.length : link.chars;

  return (
    <motion.div
      className="hc-process-layout"
      ref={sectionRef}
      variants={SECTION_RISE}
      initial="hidden"
      whileInView="shown"
      viewport={SECTION_IN_VIEW}
      transition={reduceMotion ? REDUCED_FADE_IN : { duration: 0.6, ease: STORY_EASE }}
    >
      <motion.div className="hc-process-copy" variants={COPY_CASCADE}>
        <motion.h2 variants={COPY_ITEM}>
          <span>Lead generating ads for</span>
          <span className="hc-process-prompt">Facebook &amp; Instagram</span>
        </motion.h2>

        <motion.div className="hc-process-actions" variants={COPY_ITEM}>
          <a className="hc-button hc-button--primary" href="#trial">
            Start free trial
            <ArrowRight aria-hidden="true" size={17} />
          </a>
          <small className="hc-process-note">Free trial · No card required · Cancel anytime</small>
        </motion.div>
      </motion.div>

      <motion.div
        className="hc-process-demo"
        data-scene={scene}
        data-step={activeStep}
        data-typing={copy.typing || link.typing ? "true" : undefined}
        aria-label="Animated example of choosing an ad and approving a campaign"
        variants={DEMO_RISE}
      >
        <div className="hc-process-demo-topbar">
          <span><i aria-hidden="true" /> Blockwise Ad Studio</span>

          <div className="hc-process-stage">
            <div className="hc-process-steps" ref={stepsRef} role="group" aria-label="How Blockwise works">
              {indicator ? (
                <span
                  className="hc-process-step-indicator"
                  style={{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }}
                  aria-hidden="true"
                />
              ) : null}
              {PROCESS_STEPS.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={activeStep === index}
                  onClick={() => selectStep(index)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                className="hc-process-brief"
                key={activeStep}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.24, ease: STORY_EASE }}
              >
                {PROCESS_STEPS[activeStep].hint}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        <p className="hc-sr-only" aria-live="polite">{STORY_STATUS[phase]}</p>
        <LayoutGroup id="blockwise-story">
          <div className="hc-story-viewport" aria-hidden="true">
            {/* Every scene stays mounted and cross-fades on a CSS transition, so
                the swap is one interpolation rather than a mount/unmount race. */}
            <LibraryScene phase={phase} narrow={narrow} active={scene === "browse"} />
            <EditorScene
              phase={phase}
              copyChars={copyChars}
              linkChars={link.chars}
              copyTyping={copy.typing}
              linkTyping={link.typing}
              active={scene === "edit"}
            />
            <ReviewScene
              phase={phase}
              copyChars={copyChars}
              linkChars={linkChars}
              approved={phase >= PRESS_PHASE}
              reduceMotion={reduceMotion}
              active={scene === "review"}
            />
          </div>
        </LayoutGroup>
      </motion.div>
    </motion.div>
  );
}
