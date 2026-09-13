"use client";

import { Check } from "lucide-react";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";
import { creativeImageSrcSet } from "@/lib/homepage-concept/creative-image";
import { TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import { homepageMotion, useHydratedReducedMotion } from "@/lib/motion";
import { STUDY_NARROW_BREAKPOINT, studyAdMotion, studyEditLayout, studyTypingSchedule, studyText, studyFrame, studyTransition } from "./workflow-motion-study-geometry";
import styles from "./workflow-motion-study.module.css";

const STUDY_STEPS = [
  { label: "Choose" },
  { label: "Customise" },
  { label: "Review" },
] as const;
const SELECTED_AD = AD_EXAMPLES[0];
const SIDE_ADS = [
  { ...AD_EXAMPLES[1], image: "/home/open-home-living.webp", position: 0 },
  { ...AD_EXAMPLES[3], image: "/home/home-pool.webp", position: 1 },
  { ...AD_EXAMPLES[2], image: "/home/home-dusk.webp", position: 3 },
] as const;
const TIMING = homepageMotion.workflowStudy;
const TEMPLATE_HEADLINE = "Thinking of selling?";
const AD_TEXT = "Thinking of selling? Find out what your home could be worth.";

const EDIT_TEXTS = [SELECTED_AD.adTitle, AD_TEXT] as const;
const REVIEW_TEXTS = ["Homeowners and potential sellers", "$20 per day", "14 days"] as const;
const EDIT_WRITING = studyTypingSchedule(EDIT_TEXTS, TIMING.characterMs, TIMING.fieldGapMs);
const REVIEW_WRITING = studyTypingSchedule(REVIEW_TEXTS, TIMING.characterMs, TIMING.fieldGapMs);

function useDraftText(clock: MotionValue<number>, text: string, start: number, end: number, fallback = "") {
  const value = useTransform(clock, n => studyText(n, text, start, end, fallback));
  const [display, setDisplay] = useState(value.get());
  useMotionValueEvent(value, "change", setDisplay);
  return display;
}

function StudyField({ clock, id, label, text, start, end, rows = 2 }: { clock: MotionValue<number>; id: string; label: string; text: string; start: number; end: number; rows?: number }) {
  const value = useDraftText(clock, text, start, end);
  const active = useTransform(clock, n => n > start && n < end ? 1 : 0);
  return <label htmlFor={id}><span>{label}</span><div className={styles.bwStudyField}>
    <textarea id={id} aria-label={label} readOnly rows={rows} value={value} />
    <motion.span className={styles.bwStudyFieldFocus} style={{ opacity: active }} aria-hidden="true" />
  </div></label>;
}

function StudyReviewValue({ clock, text, start, end }: { clock: MotionValue<number>; text: string; start: number; end: number }) {
  const value = useDraftText(clock, text, start, end);
  return <dd>{value}</dd>;
}

function StudyAd({ draft, headline, live, isLive = false, ad = SELECTED_AD }: { live?: MotionValue<number>; isLive?: boolean; ad?: {image: string; postCopy: string; linkTitle: string}; draft?: MotionValue<number>; headline?: string }) {
  const staticClock = useMotionValue(0);
  const clock = draft ?? staticClock;
  const title = useDraftText(clock, SELECTED_AD.adTitle, EDIT_WRITING.ranges[0].start, EDIT_WRITING.ranges[0].end, TEMPLATE_HEADLINE);
  const copy = useDraftText(clock, AD_TEXT, EDIT_WRITING.ranges[1].start, EDIT_WRITING.ranges[1].end, SELECTED_AD.postCopy);
  return <article className={styles.bwStudySelectedAd} aria-label={headline ? "Ready-made ad" : "Selected ad preview"}>
    <header className={styles.bwStudyAdHead}>
      <span className={styles.bwStudyAvatar} aria-hidden="true">AM</span>
      <span><strong>Ad preview</strong><small>Sponsored</small></span>
      <span className={styles.bwStudyMore} aria-hidden="true">•••</span>
    </header>
    <p className={styles.bwStudyAdCopy}>{headline ? ad.postCopy : copy}</p>
    <div className={styles.bwStudyAdImage}>
      <img src={withBasePath(ad.image)} srcSet={creativeImageSrcSet(ad.image)} alt="" width="1080" height="1350" sizes="300px" loading="lazy" decoding="async" />
      {live && <motion.span className={styles.bwStudyLiveBadge} style={{ opacity: live }} aria-hidden={!isLive}><i aria-hidden="true" />Live</motion.span>}
      <span className={styles.bwStudyAdHeadline}>
        <i aria-hidden="true" />
        <span className={styles.bwStudyHeadlineStack}><span>{headline ?? title}</span></span>
      </span>
    </div>
    <div className={styles.bwStudyLink}><small>BLOCKWISE.EXAMPLE</small><strong>{ad.linkTitle}</strong></div>
    <div className={styles.bwStudyActions} aria-hidden="true"><span>Like</span><span>Comment</span><span>Share</span></div>
  </article>;
}

function BrowseAd({ ad, browse, start, stride }: { ad: typeof SIDE_ADS[number]; browse: MotionValue<number>; start: {x: number; y: number}; stride: number }) {
  const x = useTransform(browse, value => start.x + (ad.position - value * 2) * stride);
  return <motion.div className={styles.bwStudyBrowseAd} style={{ x, y: start.y }}><StudyAd ad={ad} headline={ad.adTitle} /></motion.div>;
}

export function WorkflowMotionStudy() {
  const reduced = useHydratedReducedMotion();
  // 0 Choose, 1 Customise, 2 Review, 3 approved. Every animated layer shares this clock.
  const [scene, setScene] = useState(-2);
  const [settledScene, setSettledScene] = useState<number | null>(-2);
  const [manual, setManual] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [geometry, setGeometry] = useState({ stageWidth: 695, stageHeight: 560, adWidth: 260, adHeight: 502 });
  const [geometryReady, setGeometryReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const adRef = useRef<HTMLDivElement>(null);
  const playback = useRef<{ stop(): void; pause(): void; play(): void } | null>(null);
  const progress = useMotionValue(1);
  const draft = useMotionValue(0);
  const reviewFill = useMotionValue(0);
  const contentPlayback = useRef<{ stop(): void; pause(): void; play(): void } | null>(null);
  const [contentDone, setContentDone] = useState(false);
  const frame = useMotionValue(studyFrame(-2));
  const narrow = geometry.stageWidth < STUDY_NARROW_BREAKPOINT;
  const step = Math.max(0, Math.min(scene, 2));
  const active = pageVisible && (inView || manual);
  const start = studyAdMotion({ ...geometry, narrow, customise: false });
  const end = studyAdMotion({ ...geometry, narrow, customise: true });
  const stride = geometry.adWidth + 24;
  const browse = useTransform(frame, f => f.browse);
  const x = useTransform(frame, f => start.x + (end.x - start.x) * f.ad + (1 - f.browse) * 2 * stride);
  const y = useTransform(frame, f => start.y + (end.y - start.y) * f.ad - f.hop * 10);
  const scale = useTransform(frame, f => 1 + (end.scale - 1) * f.ad);
  const galleryOpacity = useTransform(frame, f => f.gallery);
  const panelOpacity = useTransform(frame, f => f.panel * f.shellAlpha);
  const panelScale = useTransform(frame, f => f.shell);
  const panelX = useTransform(frame, f => narrow ? 0 : (1 - f.ad) * geometry.adWidth * 0.6);
  const panelY = useTransform(frame, f => narrow ? (1 - f.ad) * geometry.adHeight * 1.2 : 0);
  const editOpacity = useTransform(frame, f => f.edit);
  const reviewOpacity = useTransform(frame, f => f.review);
  const approvalReady = useTransform(frame, f => f.approved > 0 ? 1 : 0);
  const pendingOpacity = useTransform(frame, f => 1 - f.approved);
  const approvedOpacity = useTransform(frame, f => f.approved);
  const layout = studyEditLayout({ ...geometry, narrow });

  useEffect(() => {
    const stage = stageRef.current;
    const ad = adRef.current;
    if (!stage || !ad) return;
    const measure = () => {
      setGeometry({ stageWidth: stage.clientWidth, stageHeight: stage.clientHeight, adWidth: ad.offsetWidth, adHeight: ad.offsetHeight });
      setGeometryReady(true);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    resize.observe(ad);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    observer.observe(stage);
    const visibility = () => setPageVisible(document.visibilityState === "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { resize.disconnect(); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    if (reduced) { setManual(true); setScene(3); }
  }, [reduced]);

  useEffect(() => {
    playback.current?.stop();
    const from = frame.get();
    const to = studyFrame(scene);
    if (reduced || Object.keys(to).every(key => from[key as keyof typeof from] === to[key as keyof typeof to])) {
      frame.set(to);
      setSettledScene(scene);
      return;
    }
    if (scene === 1) draft.set(0);
    if (scene === 2) { reviewFill.set(0); draft.set(1); }
    setContentDone(false);
    setSettledScene(null);
    // Capture the current visual frame before restarting the clock, never the previous screen endpoint.
    progress.set(0);
    const panelSwap = from.ad === 1 && to.ad === 1 && (from.edit !== to.edit || from.review !== to.review);
    const controls = animate(progress, 1, {
      duration: (scene < 0 ? TIMING.browseMs : panelSwap ? TIMING.panelSwapMs : scene < 3 ? TIMING.travelMs : TIMING.crossfadeMs) / 1000,
      ease: panelSwap ? "linear" : TIMING.ease,
      onUpdate: value => frame.set(studyTransition(from, to, value)),
      onComplete: () => { frame.set(to); setSettledScene(scene); },
    });
    playback.current = controls;
    return () => controls.stop();
  }, [draft, frame, progress, reduced, reviewFill, scene]);

  // Writing starts only after the empty panel has reached its final position.
  useEffect(() => {
    contentPlayback.current?.stop();
    if (reduced) { draft.set(1); reviewFill.set(1); setContentDone(true); return; }
    if (settledScene !== scene || (scene !== 1 && scene !== 2)) return;
    const clock = scene === 1 ? draft : reviewFill;
    const controls = animate(clock, 1, {
      duration: (scene === 1 ? EDIT_WRITING.durationMs : REVIEW_WRITING.durationMs) / 1000,
      ease: "linear",
      onComplete: () => setContentDone(true),
    });
    contentPlayback.current = controls;
    if (!active) controls.pause();
    return () => controls.stop();
  }, [draft, reduced, reviewFill, scene, settledScene]);

  useEffect(() => {
    if (active) playback.current?.play();
    else playback.current?.pause();
    if (active) contentPlayback.current?.play();
    else contentPlayback.current?.pause();
  }, [active, scene]);

  useEffect(() => {
    if (!geometryReady || !active || reduced || settledScene !== scene || ((scene === 1 || scene === 2) && !contentDone) || scene === 3 || (manual && scene >= 0 && scene < 2)) return;
    const hold = scene < 0 ? TIMING.browseHoldMs : scene === 0 ? TIMING.autoHoldMs : scene === 1 ? TIMING.reviewHoldMs : TIMING.approvalHoldMs;
    const timer = window.setTimeout(() => setScene(scene + 1), hold);
    return () => window.clearTimeout(timer);
  }, [active, contentDone, geometryReady, manual, reduced, scene, settledScene]);

  const selectStep = (next: number) => {
    setManual(true);
    if (next === step) return;
    setScene(reduced && next === 2 ? 3 : next);
  };

  return <div className={"tw " + styles.bwStudy} data-narrow={narrow ? "true" : "false"}>
    <header className={styles.bwStudyIntro}>
      <h2><span>Lead generating ads for</span><span>Facebook &amp; Instagram</span></h2>
      <div><Button asChild size="lg"><a href={TRIAL_SIGNUP_URL}>Start free trial</a></Button><small>Free trial · No card required · Cancel anytime</small></div>
    </header>
    <section className={styles.bwStudyFrame} aria-label="Ad Studio motion study">
      <header className={styles.bwStudyToolbar}>
        <span className={styles.bwStudyTitle}><i aria-hidden="true" /> Ad Studio</span>
        <div className={styles.bwStudySelector} role="group" aria-label="Motion study screen">
          {STUDY_STEPS.map((item, index) => <Button key={item.label} type="button" variant="ghost-pill" size="pill" arrow={null} aria-pressed={step === index} onClick={() => selectStep(index)}>{item.label}</Button>)}
        </div>
      </header>
      <div className={styles.bwStudyStage} ref={stageRef} data-step={STUDY_STEPS[step].label.toLowerCase()} data-settled={settledScene === scene} style={{ "--study-panel-left": `${layout.panelLeft}px`, "--study-panel-top": `${layout.panelTop}px`, "--study-panel-width": `${layout.panelWidth}px` } as React.CSSProperties}>
        <motion.div className={styles.bwStudyGallery} style={{ opacity: galleryOpacity }} aria-hidden={step !== 0}>
          {SIDE_ADS.map(ad => <BrowseAd key={ad.id} ad={ad} browse={browse} start={start} stride={stride} />)}
        </motion.div>
        <motion.div className={styles.bwStudyAdMotion} ref={adRef} style={geometryReady ? { left: 0, x, y, scale } : { visibility: "hidden" }}>
          <StudyAd draft={draft} live={approvedOpacity} isLive={scene === 3} />
        </motion.div>
        <div className={styles.bwStudyEditSlot} inert={step === 0} aria-hidden={step === 0}>
          <motion.div className={styles.bwStudyPanelSurface} style={{ opacity: panelOpacity, scale: panelScale, x: panelX, y: panelY }}>
            <motion.section className={styles.bwStudyEditPanel} style={{ opacity: editOpacity }} aria-label="Customise your ad" aria-hidden={step !== 1} inert={step !== 1}>
              <div className={styles.bwStudyPanelHeading}><h2>Make it yours</h2></div>
              <StudyField clock={draft} id="study-headline" label="Headline" text={SELECTED_AD.adTitle} {...EDIT_WRITING.ranges[0]} />
              <StudyField clock={draft} id="study-ad-text" label="Ad text" text={AD_TEXT} {...EDIT_WRITING.ranges[1]} rows={3} />
            </motion.section>
            <motion.section className={styles.bwStudyEditPanel} style={{ opacity: reviewOpacity }} aria-label="Review your ad setup" aria-hidden={step !== 2} inert={step !== 2}>
              <div className={styles.bwStudyPanelHeading}><h2>Ready to review</h2></div>
              <dl className={styles.bwStudyReviewList}><div><dt>Who sees it</dt><StudyReviewValue clock={reviewFill} text={REVIEW_TEXTS[0]} {...REVIEW_WRITING.ranges[0]} /></div><div><dt>Daily budget</dt><StudyReviewValue clock={reviewFill} text={REVIEW_TEXTS[1]} {...REVIEW_WRITING.ranges[1]} /></div><div><dt>Duration</dt><StudyReviewValue clock={reviewFill} text={REVIEW_TEXTS[2]} {...REVIEW_WRITING.ranges[2]} /></div></dl>
              <motion.div className={styles.bwStudyApprovalStack} style={{ opacity: approvalReady }}>
                <motion.div className={styles.bwStudyApprovalStatus} style={{ opacity: pendingOpacity }} aria-hidden="true">Approving ad</motion.div>
                <motion.div className={styles.bwStudyApprovalStatus} data-approved="true" style={{ opacity: approvedOpacity }} aria-hidden="true"><Check aria-hidden="true" size={18} /> Ad approved</motion.div>
                <span className={styles.bwStudySrOnly} role="status">{scene === 3 ? "Ad approved" : "Approving ad"}</span>
              </motion.div>
            </motion.section>
          </motion.div>
        </div>
      </div>
    </section>
  </div>;
}
