"use client";

import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { AdPreview } from "@/components/homepage-concept/ad-preview";
import { ResultsReporting } from "@/components/homepage-concept/results-reporting";
import { AD_EXAMPLES, FAQS, withBasePath } from "@/lib/homepage-concept/content";
import { requestMockTrial, validateTrialEmail } from "@/lib/homepage-concept/mock-trial";

type FormState = "idle" | "loading" | "success" | "error";

function PrimaryLink({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <a className={`hc-button hc-button--primary ${className}`} href="#trial">
      {children}
      <ArrowRight aria-hidden="true" size={17} />
    </a>
  );
}

function TrialForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;

    const validationError = validateTrialEmail(email);
    if (validationError) {
      setState("error");
      setMessage(validationError);
      return;
    }

    setState("loading");
    setMessage("");
    try {
      const result = await requestMockTrial(email);
      setState("success");
      setMessage(result.message);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <form className="hc-trial-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="trial-email">Work email</label>
      <div className="hc-trial-row">
        <input
          id="trial-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@agency.com.au"
          value={email}
          aria-invalid={state === "error"}
          aria-describedby="trial-note trial-status"
          disabled={state === "loading"}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state !== "idle") {
              setState("idle");
              setMessage("");
            }
          }}
        />
        <button className="hc-button hc-button--light" type="submit" disabled={state === "loading"}>
          {state === "loading" ? "Preparing demo…" : "Start free trial"}
          {state === "loading" ? <span className="hc-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" size={17} />}
        </button>
      </div>
      <p id="trial-note" className="hc-form-note">No card required. Ad spend is separate.</p>
      <p
        id="trial-status"
        className={`hc-form-status hc-form-status--${state}`}
        role={state === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {message || "Preview form only — nothing will be sent or saved."}
      </p>
    </form>
  );
}

const PROCESS_STEPS = [
  { label: "Choose" },
  { label: "Customise" },
  { label: "Review" },
] as const;

const STORY_PHASE_DELAYS = [950, 900, 900, 950, 1100, 1750, 1050] as const;
const STORY_STEP_PHASES = [1, 2, 5] as const;
const STORY_PHASE_TO_STEP = [0, 0, 1, 1, 1, 2, 2] as const;
const STORY_TEMPLATE_SEQUENCE = [0, 1, 2, 0] as const;
const STORY_STATUS = [
  "Choose a template",
  "Template selected",
  "Customise the ad",
  "Editing the post copy",
  "Editing text on the creative",
  "Review campaign",
  "Review campaign",
] as const;

const STORY_CREATIVE = {
  image: "/home/home-pool.webp",
  account: "West Coast Home Co",
  avatar: "WCH",
  startingCopy: "A better way to spend summer starts at home.",
  editedCopy: "A better way to spend summer starts at home. Explore the new guide.",
  startingOverlay: "POOL DAYS START HERE",
  editedOverlay: "YOUR SUMMER ADDRESS",
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
    <motion.article className={`hc-story-ad${review ? " is-review" : ""}`} transition={STORY_MOVE}>
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
      <motion.div className="hc-ad-image-wrap hc-story-ad-image" transition={STORY_MOVE}>
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
                  <img src={withBasePath(selected && active ? STORY_CREATIVE.image : example.image)} alt="" width="1080" height="1350" />
                  {selected && active ? <span className="hc-story-selected"><Check aria-hidden="true" size={13} /> Selected</span> : null}
                </motion.div>
                <span><strong>{selected && active ? "Poolside guide" : example.label}</strong><small>Facebook &amp; Instagram</small></span>
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
  const valuesFilled = phase >= 5;
  const pressing = phase === 6;

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
                    {valuesFilled ? value : "—"}
                  </motion.span>
                </AnimatePresence>
              </dd>
            </div>
          ))}
        </dl>
        <motion.strong
          className="hc-story-approve"
          animate={{ scale: pressing ? 0.97 : 1 }}
          transition={{ duration: 0.15, ease: "easeInOut" }}
        >
          <ShieldCheck aria-hidden="true" size={15} />
          Approve campaign
          {pressing ? <StoryCursor pressed /> : null}
        </motion.strong>
      </motion.div>
    </motion.div>
  );
}

function ProcessShowcase() {
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
    setPlaying(false);
  }

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (phase >= STORY_STATUS.length - 1) setPhase(0);
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
          <PrimaryLink>Start free trial</PrimaryLink>
        </div>
      </div>

      <div className="hc-process-demo" data-scene={scene} aria-label="Animated example of creating and approving an ad">
        <div className="hc-process-demo-topbar">
          <span><i aria-hidden="true" /> Blockwise Ad Studio</span>
          <ol aria-hidden="true">
            {PROCESS_STEPS.map((item, index) => <li className={activeStep === index ? "is-active" : ""} key={item.label}>{item.label}</li>)}
          </ol>
          <button type="button" onClick={togglePlayback} hidden={reduceMotion} aria-label={playing ? "Pause preview" : "Play preview"} title={playing ? "Pause preview" : "Play preview"}>
            {playing ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
          </button>
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

function HeroAdStack() {
  const visualRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => setReducedMotion(motionQuery.matches);
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !motionQuery.matches) setPlaying(true);
    }, { threshold: 0.28 });

    setReducedMotion(motionQuery.matches);
    if (visualRef.current) observer.observe(visualRef.current);
    motionQuery.addEventListener("change", onMotionChange);
    return () => {
      observer.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  function replay() {
    if (reducedMotion) return;
    setPlaying(false);
    window.requestAnimationFrame(() => setPlaying(true));
  }

  const example = AD_EXAMPLES[0];
  return (
    <div className={`hc-hero-visual${playing ? " is-playing" : ""}`} ref={visualRef}>
      <div className="hc-hero-visual-head">
        <span>Your next ad</span>
        <button type="button" onClick={replay} disabled={reducedMotion} aria-label="Replay ad preview animation">Replay preview</button>
      </div>
      <div className="hc-hero-stack">
        <div className="hc-hero-story">
          <span className="hc-hero-format">Story</span>
          <AdPreview image={example.image} postCopy={example.postCopy} linkTitle={example.linkTitle} compact />
        </div>
        <div className="hc-hero-feed">
          <span className="hc-hero-format">Feed</span>
          <AdPreview image={example.image} postCopy={example.postCopy} linkTitle={example.linkTitle} compact />
        </div>
      </div>
      <p className="hc-hero-status"><i aria-hidden="true" /> Ready for your review</p>
    </div>
  );
}

export function HomepageConcept() {
  const [selectedExample, setSelectedExample] = useState(0);
  const activeExample = AD_EXAMPLES[selectedExample];
  const exampleDetails = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 600px)");
    const syncDisclosure = () => {
      if (exampleDetails.current) exampleDetails.current.open = !phone.matches;
    };
    syncDisclosure();
    phone.addEventListener("change", syncDisclosure);
    return () => phone.removeEventListener("change", syncDisclosure);
  }, []);

  return (
    <div className="hc-root">
      <header className="hc-header">
        <a className="hc-logo" href="#top" aria-label="Blockwise homepage concept">
          <img src={withBasePath("/brand/blockwise-logo-white.svg")} alt="Blockwise" width="142" height="32" />
        </a>
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#examples">Examples</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="hc-header-cta" href="#trial">Start free trial</a>
      </header>

      <main>
        <section className="hc-hero" id="top">
          <div className="hc-shell hc-hero-grid">
            <div className="hc-hero-copy">
              <h1><span>Your competition is running ads.</span> <span className="hc-hero-prompt">Are you?</span></h1>
              <p>More listings, less marketing stress.</p>
              <div className="hc-hero-actions">
                <PrimaryLink>Start free trial</PrimaryLink>
                <span><Check aria-hidden="true" size={16} /> No card required.</span>
              </div>
            </div>
            <HeroAdStack />
          </div>
        </section>
        <section className="hc-process" id="how-it-works">
          <div className="hc-shell">
            <ProcessShowcase />
          </div>
        </section>

        <ResultsReporting />

        <section className="hc-examples" id="examples">
          <div className="hc-shell">
            <div className="hc-section-copy hc-section-copy--wide">
              <h2>Your brand. Your ads.</h2>
              <p>Choose an objective, then adapt the creative and message to your agency.</p>
            </div>
            <div className="hc-example-tabs" role="group" aria-label="Choose an ad example">
              {AD_EXAMPLES.map((example, index) => (
                <button
                  key={example.id}
                  type="button"
                  id={`example-tab-${example.id}`}
                  aria-pressed={selectedExample === index}
                  onClick={() => setSelectedExample(index)}
                >
                  {example.label}
                </button>
              ))}
            </div>
            <div
              className="hc-example-stage"
              id="example-panel"
            >
              <details ref={exampleDetails} className="hc-example-copy hc-example-details" open>
                <summary>About this ad <ChevronRight aria-hidden="true" size={18} /></summary>
                <h3>{activeExample.title}</h3>
                <p>{activeExample.body}</p>
                <dl>
                  <div><dt>Objective</dt><dd>Lead generation</dd></div>
                  <div><dt>Format</dt><dd>Facebook &amp; Instagram feed</dd></div>
                  <div><dt>Approval</dt><dd>Required before launch</dd></div>
                </dl>
              </details>
              <AdPreview image={activeExample.image} postCopy={activeExample.postCopy} linkTitle={activeExample.linkTitle} />
            </div>
          </div>
        </section>

        <section className="hc-control" id="control">
          <div className="hc-shell hc-control-grid">
            <div className="hc-section-copy">
              <h2>You&rsquo;re in control.</h2>
              <p>Creative, budget, status and reporting—when you need the detail.</p>
            </div>
            <div className="hc-detail-list">
              <details open>
                <summary><span><MousePointer2 aria-hidden="true" size={20} /> Creative control</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>Change the property, offer, copy, call to action and brand details before approval.</p>
              </details>
              <details>
                <summary><span><CircleDollarSign aria-hidden="true" size={20} /> Budget control</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>Review the daily budget and schedule. Meta ad spend is separate and paid from your connected ad account.</p>
              </details>
              <details>
                <summary><span><BarChart3 aria-hidden="true" size={20} /> Campaign detail</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>See status, spend and lead activity, with deeper campaign detail available when needed.</p>
              </details>
              <details>
                <summary><span><Clock3 aria-hidden="true" size={20} /> Helpful updates</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>Use the dashboard for the full view or receive a short optional email update.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="hc-faq" id="faq">
          <div className="hc-shell hc-faq-grid">
            <div className="hc-section-copy">
              <h2>FAQ</h2>
              <p>What to expect before you start.</p>
            </div>
            <div className="hc-faq-list">
              {FAQS.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="hc-trial" id="trial">
          <div className="hc-shell hc-trial-grid">
            <div>
              <h2>Start with your email.</h2>
              <p>Try the guided setup in this homepage concept.</p>
              <div className="hc-trial-points">
                <span><Sparkles aria-hidden="true" size={18} /> Polished templates</span>
                <span><ShieldCheck aria-hidden="true" size={18} /> Approval before launch</span>
                <span><BarChart3 aria-hidden="true" size={18} /> Results in one place</span>
              </div>
            </div>
            <TrialForm />
          </div>
        </section>
      </main>

      <footer className="hc-footer">
        <div className="hc-shell">
          <img src={withBasePath("/brand/blockwise-logo.svg")} alt="Blockwise" width="134" height="30" />
          <p>Real estate ads, made manageable.</p>
          <nav aria-label="Footer navigation">
            <a href="https://blockwise.sale/pricing" target="_blank" rel="noreferrer">Pricing</a>
            <a href="#top">Back to top</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
