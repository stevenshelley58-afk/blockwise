"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { AD_EXAMPLES, AD_LIBRARY, withBasePath } from "@/lib/homepage-concept/content";
import { creativeImageSrcSet } from "@/lib/homepage-concept/creative-image";
import { homepageMotion, useHydratedReducedMotion } from "@/lib/motion";

import "./workflow-motion-study.css";

const STUDY_STEPS = [
  { label: "Choose", hint: "Pick a ready-made ad" },
  { label: "Customise", hint: "Add your text and link title" },
] as const;
type StudyStep = (typeof STUDY_STEPS)[number]["label"];
const SELECTED_AD = { ...AD_EXAMPLES[0], id: "motion-study-selected" } as const;
const SIDE_ADS = [AD_LIBRARY[0], AD_LIBRARY[2]] as const;
const TIMING = homepageMotion.workflowStudy;

function useNarrowStudy() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

function usePageActivity() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    if (rootRef.current) observer.observe(rootRef.current);
    const sync = () => setPageVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return { rootRef, inView, pageVisible };
}

function StudyAd({ headlineChars }: { headlineChars: number }) {
  const headline = SELECTED_AD.adTitle.slice(0, headlineChars);
  return (
    <motion.article
      className="bw-study-selected-ad"
      aria-label="Selected ad preview"
      layout
      transition={{ duration: TIMING.adMoveMs / 1000, ease: TIMING.ease }}
    >
      <header className="bw-study-ad-head">
        <span className="bw-study-avatar" aria-hidden="true">AM</span>
        <span><strong>Ad preview</strong><small>Sponsored</small></span>
        <span className="bw-study-more" aria-hidden="true">•••</span>
      </header>
      <p className="bw-study-ad-copy">Thinking of selling? Find out what your home could be worth.</p>
      <div className="bw-study-ad-image">
        <img
          src={withBasePath(SELECTED_AD.image)}
          srcSet={creativeImageSrcSet(SELECTED_AD.image)}
          alt=""
          width="1080"
          height="1350"
          sizes="(min-width: 1000px) 700px, 560px"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <span className="bw-study-ad-headline">
          <i aria-hidden="true" />
          {headline || <em>{SELECTED_AD.adTitle}</em>}
        </span>
      </div>
      <div className="bw-study-link"><small>BLOCKWISE.EXAMPLE</small><strong>{SELECTED_AD.linkTitle}</strong></div>
      <div className="bw-study-actions" aria-hidden="true"><span>Like</span><span>Comment</span><span>Share</span></div>
    </motion.article>
  );
}

function SideAd({ ad }: { ad: (typeof SIDE_ADS)[number] }) {
  return (
    <motion.div className="bw-study-side-ad" initial={{ opacity: 1 }} animate={{ opacity: 1 }} transition={{ duration: TIMING.sideFadeMs / 1000 }}>
      <img src={withBasePath(ad.image)} srcSet={creativeImageSrcSet(ad.image)} alt="" width="1080" height="1350" sizes="(min-width: 1000px) 250px, 30vw" loading="lazy" decoding="async" />
    </motion.div>
  );
}

function EditPanel({ headlineChars, reduced }: { headlineChars: number; reduced: boolean }) {
  const headline = SELECTED_AD.adTitle.slice(0, headlineChars);
  return (
    <motion.section
      className="bw-study-edit-panel"
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : TIMING.panelRevealMs / 1000, delay: reduced ? 0 : (TIMING.adMoveMs / 1000) * 0.62, ease: TIMING.ease }}
      aria-label="Customise your ad"
    >
      <div className="bw-study-panel-heading"><span className="bw-study-kicker">Customise</span><h2>Make it yours</h2></div>
      <label className={headlineChars > 0 ? "is-active" : undefined}><span>Headline</span><strong>{headline || "Your headline appears here"}</strong></label>
      <label><span>Ad text</span><strong>Thinking of selling? Find out what your home could be worth.</strong></label>
      <label><span>Link title</span><strong>{SELECTED_AD.linkTitle}</strong></label>
    </motion.section>
  );
}

export function WorkflowMotionStudy() {
  const reduced = useHydratedReducedMotion();
  const narrow = useNarrowStudy();
  const { rootRef, inView, pageVisible } = usePageActivity();
  const [step, setStep] = useState<StudyStep>("Choose");
  const [manual, setManual] = useState(false);
  const [headlineChars, setHeadlineChars] = useState(0);

  const selectStep = useCallback((next: StudyStep) => {
    setManual(true);
    setStep(next);
    if (next === "Choose") setHeadlineChars(0);
  }, []);

  useEffect(() => {
    if (reduced) {
      setManual(true);
      setStep("Customise");
      setHeadlineChars(SELECTED_AD.adTitle.length);
    }
  }, [reduced]);

  useEffect(() => {
    if (manual || reduced || step !== "Choose" || !inView || !pageVisible) return;
    const timer = window.setTimeout(() => setStep("Customise"), TIMING.autoHoldMs);
    return () => window.clearTimeout(timer);
  }, [inView, manual, pageVisible, reduced, step]);

  useEffect(() => {
    if (step !== "Customise") {
      setHeadlineChars(0);
      return;
    }
    if (reduced) {
      setHeadlineChars(SELECTED_AD.adTitle.length);
      return;
    }
    if (!inView || !pageVisible) return;
    let index = 0;
    let timer: number | null = null;
    const start = window.setTimeout(() => {
      const tick = () => {
        index += 1;
        setHeadlineChars(index);
        if (index < SELECTED_AD.adTitle.length) timer = window.setTimeout(tick, TIMING.typeMs);
      };
      tick();
    }, TIMING.typeStartMs);
    return () => {
      window.clearTimeout(start);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [inView, pageVisible, reduced, step]);

  const customise = step === "Customise";
  const adMotion = narrow
    ? customise ? { x: -54, y: -118, scale: 0.78 } : { x: 0, y: 0, scale: 1 }
    : customise ? { x: -250, y: 12, scale: 0.78 } : { x: 0, y: 0, scale: 1 };

  return (
    <MotionConfig reducedMotion="user">
      <main className="bw-study" ref={rootRef}>
        <section className="bw-study-frame" aria-label="Ad Studio motion study">
          <header className="bw-study-toolbar">
            <span className="bw-study-title"><i aria-hidden="true" /> Ad Studio</span>
            <div className="bw-study-selector" role="group" aria-label="Motion study screen">
              {STUDY_STEPS.map((item) => (
                <Button key={item.label} type="button" variant="ghost-pill" size="pill" arrow={null} aria-pressed={step === item.label} onClick={() => selectStep(item.label)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </header>
          <div className="bw-study-stage" data-step={step.toLowerCase()}>
            <div className="bw-study-gallery" aria-hidden={customise}>
              {SIDE_ADS.map((ad) => <SideAd key={ad.id} ad={ad} />)}
            </div>
            <motion.div className="bw-study-ad-motion" animate={adMotion} transition={{ duration: TIMING.adMoveMs / 1000, ease: TIMING.ease }}>
              <StudyAd headlineChars={headlineChars} />
            </motion.div>
            <AnimatePresence initial={false}>{customise ? <EditPanel key="edit" headlineChars={headlineChars} reduced={reduced} /> : null}</AnimatePresence>
          </div>
          <p className="bw-study-hint" aria-live="polite">{STUDY_STEPS.find((item) => item.label === step)?.hint}</p>
        </section>
      </main>
    </MotionConfig>
  );
}
