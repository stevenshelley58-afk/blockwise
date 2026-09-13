"use client";

import { Check } from "lucide-react";
import { animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AD_EXAMPLES, withBasePath } from "@/lib/homepage-concept/content";
import { creativeImageSrcSet } from "@/lib/homepage-concept/creative-image";
import { TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";
import { homepageMotion, useHydratedReducedMotion } from "@/lib/motion";
import { STUDY_NARROW_BREAKPOINT, studyAdMotion, studyEditLayout, studyFrame, studyTransition } from "./workflow-motion-study-geometry";
import styles from "./workflow-motion-study.module.css";

const STUDY_STEPS = [
  { label: "Choose", hint: "Pick a ready-made ad" },
  { label: "Customise", hint: "Add your text and link title" },
  { label: "Review", hint: "Check who sees it and approve the setup" },
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

function StudyAd({ original, updated, headline, ad = SELECTED_AD, customised = false }: { ad?: {image: string; postCopy: string; linkTitle: string}; customised?: boolean; original?: MotionValue<number>; updated?: MotionValue<number>; headline?: string }) {
  return <article className={styles.bwStudySelectedAd} aria-label={headline ? "Ready-made ad" : "Selected ad preview"}>
    <header className={styles.bwStudyAdHead}>
      <span className={styles.bwStudyAvatar} aria-hidden="true">AM</span>
      <span><strong>Ad preview</strong><small>Sponsored</small></span>
      <span className={styles.bwStudyMore} aria-hidden="true">•••</span>
    </header>
    <p className={styles.bwStudyAdCopy}>{headline ? ad.postCopy : AD_TEXT}</p>
    <div className={styles.bwStudyAdImage}>
      <img src={withBasePath(ad.image)} srcSet={creativeImageSrcSet(ad.image)} alt="" width="1080" height="1350" sizes="300px" loading="lazy" decoding="async" />
      <span className={styles.bwStudyAdHeadline}>
        <i aria-hidden="true" />
        <span className={styles.bwStudyHeadlineStack}>
          {headline ? headline : <>
            <motion.span style={{ opacity: original }} aria-hidden={customised}>{TEMPLATE_HEADLINE}</motion.span>
            <motion.span style={{ opacity: updated }} aria-hidden={!customised}>{SELECTED_AD.adTitle}</motion.span>
          </>}
        </span>
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
  const frame = useMotionValue(studyFrame(-2));
  const narrow = geometry.stageWidth < STUDY_NARROW_BREAKPOINT;
  const step = Math.max(0, Math.min(scene, 2));
  const active = pageVisible && (inView || manual);
  const start = studyAdMotion({ ...geometry, narrow, customise: false });
  const end = studyAdMotion({ ...geometry, narrow, customise: true });
  const stride = geometry.adWidth + 24;
  const browse = useTransform(frame, f => f.browse);
  const x = useTransform(frame, f => start.x + (end.x - start.x) * f.ad + (1 - f.browse) * 2 * stride);
  const y = useTransform(frame, f => start.y + (end.y - start.y) * f.ad);
  const scale = useTransform(frame, f => 1 + (end.scale - 1) * f.ad);
  const galleryOpacity = useTransform(frame, f => f.gallery);
  const panelOpacity = useTransform(frame, f => f.panel * f.shellAlpha);
  const panelScale = useTransform(frame, f => f.shell);
  const panelX = useTransform(frame, f => narrow ? 0 : (1 - f.ad) * geometry.adWidth * 0.6);
  const panelY = useTransform(frame, f => narrow ? (1 - f.ad) * geometry.adHeight * 1.2 : 0);
  const editOpacity = useTransform(frame, f => f.edit);
  const reviewOpacity = useTransform(frame, f => f.review);
  const originalOpacity = useTransform(frame, f => f.original);
  const updatedOpacity = useTransform(frame, f => f.updated);
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
    setSettledScene(null);
    // Capture the current visual frame before restarting the clock, never the previous screen endpoint.
    progress.set(0);
    const controls = animate(progress, 1, {
      duration: (scene < 0 ? TIMING.browseMs : scene === 2 || (scene === 1 && from.review > 0) ? TIMING.panelSwapMs : scene < 2 ? TIMING.travelMs : TIMING.crossfadeMs) / 1000,
      ease: TIMING.ease,
      onUpdate: value => frame.set(studyTransition(from, to, value)),
      onComplete: () => { frame.set(to); setSettledScene(scene); },
    });
    playback.current = controls;
    return () => controls.stop();
  }, [frame, progress, reduced, scene]);

  useEffect(() => {
    if (active) playback.current?.play();
    else playback.current?.pause();
  }, [active, scene]);

  useEffect(() => {
    if (!geometryReady || !active || reduced || settledScene !== scene || scene === 3 || (manual && scene >= 0 && scene < 2)) return;
    const hold = scene < 0 ? TIMING.browseHoldMs : scene === 0 ? TIMING.autoHoldMs : scene === 1 ? TIMING.reviewHoldMs : TIMING.approvalHoldMs;
    const timer = window.setTimeout(() => setScene(scene + 1), hold);
    return () => window.clearTimeout(timer);
  }, [active, geometryReady, manual, reduced, scene, settledScene]);

  const selectStep = (next: number) => {
    setManual(true);
    if (next === step) return;
    setScene(next === 0 && !reduced ? -2 : reduced && next === 2 ? 3 : next);
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
        <motion.div className={styles.bwStudyAdMotion} ref={adRef} style={geometryReady ? { left: 0, x, y, scale } : undefined}>
          <StudyAd original={originalOpacity} updated={updatedOpacity} customised={step !== 0} />
        </motion.div>
        <div className={styles.bwStudyEditSlot} inert={step === 0} aria-hidden={step === 0}>
          <motion.div className={styles.bwStudyPanelSurface} style={{ opacity: panelOpacity, scale: panelScale, x: panelX, y: panelY }}>
            <motion.section className={styles.bwStudyEditPanel} style={{ opacity: editOpacity }} aria-label="Customise your ad" aria-hidden={step !== 1} inert={step !== 1}>
              <div className={styles.bwStudyPanelHeading}><h2>Make it yours</h2></div>
              <label htmlFor="study-headline"><span>Headline</span><textarea id="study-headline" aria-label="Headline" readOnly rows={2} value={SELECTED_AD.adTitle} /></label>
              <label htmlFor="study-ad-text"><span>Ad text</span><textarea id="study-ad-text" aria-label="Ad text" readOnly rows={3} value={AD_TEXT} /></label>
              <label htmlFor="study-link-title"><span>Link title</span><textarea id="study-link-title" aria-label="Link title" readOnly rows={2} value={SELECTED_AD.linkTitle} /></label>
            </motion.section>
            <motion.section className={styles.bwStudyEditPanel} style={{ opacity: reviewOpacity }} aria-label="Review your ad setup" aria-hidden={step !== 2} inert={step !== 2}>
              <div className={styles.bwStudyPanelHeading}><h2>Ready to review</h2></div>
              <dl className={styles.bwStudyReviewList}><div><dt>Who sees it</dt><dd>Homeowners and potential sellers</dd></div><div><dt>Daily budget</dt><dd>$20 per day</dd></div><div><dt>Duration</dt><dd>14 days</dd></div></dl>
              <div className={styles.bwStudyApprovalStack}>
                <motion.div className={styles.bwStudyApprovalStatus} style={{ opacity: pendingOpacity }} aria-hidden="true">Approving ad</motion.div>
                <motion.div className={styles.bwStudyApprovalStatus} data-approved="true" style={{ opacity: approvedOpacity }} aria-hidden="true"><Check aria-hidden="true" size={18} /> Ad approved</motion.div>
                <span className={styles.bwStudySrOnly} role="status">{scene === 3 ? "Ad approved" : "Approving ad"}</span>
              </div>
            </motion.section>
          </motion.div>
        </div>
      </div>
      <p className={styles.bwStudyHint} aria-live="polite">{STUDY_STEPS[step].hint}</p>
    </section>
  </div>;
}
