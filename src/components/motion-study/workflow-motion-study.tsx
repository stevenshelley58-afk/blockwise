"use client";

import { Check } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";
import { creativeImageSrcSet } from "@/lib/homepage-concept/creative-image";
import { TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import { homepageMotion, useHydratedReducedMotion } from "@/lib/motion";
import { STUDY_NARROW_BREAKPOINT, studyAdMotion, studyEditLayout } from "./workflow-motion-study-geometry";
import styles from "./workflow-motion-study.module.css";

const STUDY_STEPS = [
  { label: "Choose", hint: "Pick a ready-made ad" },
  { label: "Customise", hint: "Add your text and link title" },
  { label: "Review", hint: "Check who sees it and approve the setup" },
] as const;
type StudyStep = (typeof STUDY_STEPS)[number]["label"];
const SELECTED_AD = { ...AD_EXAMPLES[0], id: "motion-study-selected" } as const;
const SIDE_ADS = [AD_EXAMPLES[1], AD_EXAMPLES[2]] as const;
const TIMING = homepageMotion.workflowStudy;
const STUDY_AD_WIDTH = 300;
const TEMPLATE_HEADLINE = "Thinking of selling?";

function usePageActivity() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
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

function StudyAd({ headlineChars, ad = AD_EXAMPLES[0], selected = true }: { headlineChars: number; ad?: (typeof AD_EXAMPLES)[number]; selected?: boolean }) {
  const headline = headlineChars > 0 ? SELECTED_AD.adTitle.slice(0, headlineChars) : TEMPLATE_HEADLINE;
  return (
    <article className={styles.bwStudySelectedAd} aria-label={selected ? "Selected ad preview" : "Ready-made ad"}>
      <header className={styles.bwStudyAdHead}>
        <span className={styles.bwStudyAvatar} aria-hidden="true">AM</span>
        <span><strong>Ad preview</strong><small>Sponsored</small></span>
        <span className={styles.bwStudyMore} aria-hidden="true">•••</span>
      </header>
      <p className={styles.bwStudyAdCopy}>Thinking of selling? Find out what your home could be worth.</p>
      <div className={styles.bwStudyAdImage}>
        <img
          src={withBasePath(SELECTED_AD.image)}
          srcSet={creativeImageSrcSet(SELECTED_AD.image)}
          alt=""
          width="1080"
          height="1350"
          sizes="300px"
          loading="lazy"
          decoding="async"
        />
        <span className={styles.bwStudyAdHeadline}>
          <i aria-hidden="true" />
          {selected ? headline : ad.adTitle}
        </span>
      </div>
      <div className={styles.bwStudyLink}><small>BLOCKWISE.EXAMPLE</small><strong>{SELECTED_AD.linkTitle}</strong></div>
      <div className={styles.bwStudyActions} aria-hidden="true"><span>Like</span><span>Comment</span><span>Share</span></div>
    </article>
  );
}

function SideAd({ ad }: { ad: (typeof SIDE_ADS)[number] }) {
  return (
    <motion.div className={styles.bwStudySideAd} initial={{ opacity: 1 }} animate={{ opacity: 1 }} transition={{ duration: TIMING.sideFadeMs / 1000 }}>
      <StudyAd headlineChars={0} ad={ad} selected={false} />
    </motion.div>
  );
}

function EditPanel({ headlineChars, reduced }: { headlineChars: number; reduced: boolean }) {
  const headline = SELECTED_AD.adTitle.slice(0, headlineChars);
  return (
    <motion.section
      className={styles.bwStudyEditPanel}
      initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : TIMING.panelRevealMs / 1000, delay: reduced ? 0 : (TIMING.adMoveMs / 1000) * 0.62, ease: TIMING.ease }}
      exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.15, delay: 0 } }}
      aria-label="Customise your ad"
    >
      <div className={styles.bwStudyPanelHeading}><h2>Make it yours</h2></div>
      <motion.label
        className={headlineChars > 0 ? styles.isActive : undefined}
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : TIMING.panelRevealMs / 1000, delay: reduced ? 0 : 0.02 }}
        htmlFor="study-headline"
      >
        <span>Headline</span>
        <textarea id="study-headline" readOnly value={headline} aria-label="Headline" rows={2} />
      </motion.label>
      <motion.label
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : TIMING.panelRevealMs / 1000, delay: reduced ? 0 : 0.08 }}
        htmlFor="study-ad-text"
      >
        <span>Ad text</span>
        <textarea id="study-ad-text" readOnly value="Thinking of selling? Find out what your home could be worth." aria-label="Ad text" rows={3} />
      </motion.label>
      <motion.label
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : TIMING.panelRevealMs / 1000, delay: reduced ? 0 : 0.14 }}
        htmlFor="study-link-title"
      >
        <span>Link title</span>
        <textarea id="study-link-title" readOnly value={SELECTED_AD.linkTitle} aria-label="Link title" rows={2} />
      </motion.label>
    </motion.section>
  );
}

function ReviewPanel({ approved, reduced }: { approved: boolean; reduced: boolean }) {
  return (
    <motion.section className={styles.bwStudyEditPanel} initial={reduced ? { opacity: 1 } : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.15, delay: 0 } }} transition={{ duration: reduced ? 0 : TIMING.panelRevealMs / 1000, ease: TIMING.ease }} aria-label="Review your ad setup">
      <div className={styles.bwStudyPanelHeading}><h2>Ready to review</h2></div>
      <dl className={styles.bwStudyReviewList}><div><dt>Who sees it</dt><dd>Homeowners and potential sellers</dd></div><div><dt>Daily budget</dt><dd>$20 per day</dd></div><div><dt>Duration</dt><dd>14 days</dd></div></dl>
      <motion.div className={styles.bwStudyApprovalStatus} data-approved={approved} animate={{ scale: approved && !reduced ? [1, 0.96, 1] : 1 }} transition={{ duration: 0.35 }} role="status">{approved ? <Check aria-hidden="true" size={18} /> : <span className={styles.bwStudyPending} aria-hidden="true" />} {approved ? "Ad approved" : "Approving ad"}</motion.div>
    </motion.section>
  );
}

export function WorkflowMotionStudy() {
  const reduced = useHydratedReducedMotion();
  const { rootRef, inView, pageVisible } = usePageActivity();
  const [step, setStep] = useState<StudyStep>("Choose");
  const [manual, setManual] = useState(false);
  const [headlineChars, setHeadlineChars] = useState(0);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 1040, height: 560 });
  const [adSize, setAdSize] = useState({ width: STUDY_AD_WIDTH, height: 550 });
  const [geometryReady, setGeometryReady] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const narrow = stageSize.width < STUDY_NARROW_BREAKPOINT;
  const stageRef = useRef<HTMLDivElement>(null);
  const adRef = useRef<HTMLDivElement>(null);
  const headlineIndexRef = useRef(0);

  const selectStep = useCallback((next: StudyStep) => {
    setManual(true);
    if (next === step) return;
    setStep(next);
    setReviewConfirmed(next === "Review" && reduced);
    if (next === "Choose") {
      headlineIndexRef.current = 0;
      setHeadlineChars(0);
    } else if (next === "Review") {
      headlineIndexRef.current = SELECTED_AD.adTitle.length;
      setHeadlineChars(SELECTED_AD.adTitle.length);
    }
  }, [reduced, step]);

  useEffect(() => {
    if (reduced) {
      setManual(true);
      setStep("Review");
      setReviewConfirmed(true);
      headlineIndexRef.current = SELECTED_AD.adTitle.length;
      setHeadlineChars(SELECTED_AD.adTitle.length);
    }
  }, [reduced]);

  useEffect(() => {
    if (!geometryReady || !motionReady || manual || reduced || step !== "Choose" || !inView || !pageVisible) return;
    const timer = window.setTimeout(() => setStep("Customise"), TIMING.autoHoldMs);
    return () => window.clearTimeout(timer);
  }, [geometryReady, motionReady, inView, manual, pageVisible, reduced, step]);

  useEffect(() => {
    if (step === "Choose") {
      headlineIndexRef.current = 0;
      setHeadlineChars(0);
      return;
    }
    if (reduced) {
      headlineIndexRef.current = SELECTED_AD.adTitle.length;
      setHeadlineChars(SELECTED_AD.adTitle.length);
      return;
    }
    if (!inView || !pageVisible) return;
    let timer: number | null = null;
    const start = window.setTimeout(() => {
      const tick = () => {
        const next = Math.min(headlineIndexRef.current + 1, SELECTED_AD.adTitle.length);
        headlineIndexRef.current = next;
        setHeadlineChars(next);
        if (next < SELECTED_AD.adTitle.length) timer = window.setTimeout(tick, TIMING.typeMs);
      };
      if (headlineIndexRef.current < SELECTED_AD.adTitle.length) tick();
    }, TIMING.typeStartMs);
    return () => {
      window.clearTimeout(start);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [inView, pageVisible, reduced, step]);

  useEffect(() => {
    if (step !== "Customise" || reduced || headlineChars < SELECTED_AD.adTitle.length || manual || !inView || !pageVisible) return;
    const timer = window.setTimeout(() => setStep("Review"), TIMING.reviewHoldMs);
    return () => window.clearTimeout(timer);
  }, [headlineChars, inView, manual, pageVisible, reduced, step]);

  useEffect(() => {
    if (step !== "Review" || reduced || !inView || !pageVisible) {
      if (step !== "Review") setReviewConfirmed(false);
      return;
    }
    if (reviewConfirmed) return;
    const timer = window.setTimeout(() => setReviewConfirmed(true), TIMING.approvalHoldMs);
    return () => window.clearTimeout(timer);
  }, [inView, pageVisible, reduced, reviewConfirmed, step]);

  useEffect(() => {
    const stage = stageRef.current;
    const ad = adRef.current;
    if (!stage || !ad) return;
    const measure = () => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
      setAdSize({ width: ad.offsetWidth, height: ad.offsetHeight });
      setGeometryReady(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(ad);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!geometryReady) return;
    const frame = window.requestAnimationFrame(() => setMotionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [geometryReady]);

  const customise = step !== "Choose";
  const review = step === "Review";
  const adMotion = studyAdMotion({
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
    adWidth: adSize.width,
    adHeight: adSize.height,
    narrow,
    customise,
  });

  const editLayout = studyEditLayout({ stageWidth: stageSize.width, adWidth: adSize.width, adHeight: adSize.height, narrow });
  const stageStyle = {
    "--study-panel-left": `${editLayout.panelLeft}px`,
    "--study-panel-top": `${editLayout.panelTop}px`,
    "--study-panel-width": `${editLayout.panelWidth}px`,
  } as import("react").CSSProperties;

  return (
    <MotionConfig reducedMotion="user">
      <div className={"tw " + styles.bwStudy} data-narrow={narrow ? "true" : "false"}>
        <header className={styles.bwStudyIntro}>
          <h2><span>Lead generating ads for</span><span>Facebook &amp; Instagram</span></h2>
          <div><Button asChild size="lg"><a href={TRIAL_SIGNUP_URL}>Start free trial</a></Button><small>Free trial · No card required · Cancel anytime</small></div>
        </header>
        <section className={styles.bwStudyFrame} aria-label="Ad Studio motion study">
          <header className={styles.bwStudyToolbar}>
            <span className={styles.bwStudyTitle}><i aria-hidden="true" /> Ad Studio</span>
            <div className={styles.bwStudySelector} role="group" aria-label="Motion study screen">
              {STUDY_STEPS.map((item) => (
                <Button key={item.label} type="button" variant="ghost-pill" size="pill" arrow={null} aria-pressed={step === item.label} onClick={() => selectStep(item.label)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </header>
          <div className={styles.bwStudyStage} ref={(node) => { stageRef.current = node; rootRef.current = node; }} data-step={step.toLowerCase()} style={stageStyle}>
            <div className={styles.bwStudyGallery} aria-hidden={customise}>
              {SIDE_ADS.map((ad) => <SideAd key={ad.id} ad={ad} />)}
            </div>
            <motion.div className={styles.bwStudyAdMotion} ref={adRef} style={{ left: geometryReady ? 0 : undefined }} initial={false} animate={geometryReady ? adMotion : undefined} transition={{ duration: !motionReady || reduced ? 0 : TIMING.adMoveMs / 1000, ease: TIMING.ease }}>
              <StudyAd headlineChars={headlineChars} />
            </motion.div>
            <AnimatePresence initial={false} mode="wait">{customise ? <div key={review ? "review" : "edit"} className={styles.bwStudyEditSlot}>{review ? <ReviewPanel approved={reviewConfirmed} reduced={reduced} /> : <EditPanel headlineChars={headlineChars} reduced={reduced} />}</div> : null}</AnimatePresence>
          </div>
          <p className={styles.bwStudyHint} aria-live="polite">{STUDY_STEPS.find((item) => item.label === step)?.hint}</p>
        </section>
      </div>
    </MotionConfig>
  );
}
