"use client";

import { Globe2, MessageCircle, MoreHorizontal, Share2, ThumbsUp } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { withBasePath } from "@/lib/homepage-concept/content";
import { CREATIVE_EDIT_EXAMPLES, creativeEditFrame, type CreativeEditExample } from "@/lib/homepage-concept/creative-edit";

import "./creative-edit-preview.css";

export type CreativeEditPreviewProps = { selectedExample: number };

function MetaFeed({ example, elapsed }: {
  example: CreativeEditExample;
  elapsed: number | null;
}) {
  const frame = elapsed === null ? { phase: "done", text: example.editedOverlay } : creativeEditFrame(elapsed, example);
  return <article className="hc-ce-ad" aria-label={`${example.label} sponsored Facebook Feed ad`}>
    <header className="hc-ce-account">
      <span className="hc-ce-avatar" aria-hidden="true">{example.avatar}</span>
      <span><strong>{example.account}</strong><small>Sponsored · <Globe2 aria-hidden="true" size={9} /></small></span>
      <MoreHorizontal aria-hidden="true" size={19} />
    </header>
    <p className="hc-ce-caption">{example.postCaption}</p>
    <div className="hc-ce-image-wrap">
      <img className="hc-ce-image" src={withBasePath(example.image)} alt="" width="1080" height="1350" />
      <motion.span className="hc-ce-overlay" data-phase={frame.phase}
        role="img" aria-label={`Creative text: ${example.editedOverlay}`}
        animate={{ opacity: frame.phase === "reset" ? 0 : 1 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
        <span className="hc-ce-text-size" aria-hidden="true">{example.initialOverlay}</span>
        <span className="hc-ce-text-size" aria-hidden="true">{example.editedOverlay}</span>
        <span className="hc-ce-text" aria-hidden="true"><span>{frame.text}</span>{frame.phase === "type" && <i className="hc-ce-caret" />}</span>
        <b className="hc-ce-handles" aria-hidden="true"><i /><i /><i /><i /></b>
      </motion.span>
    </div>
    <div className="hc-ce-link"><span><small>{example.domain}</small><strong>{example.linkTitle}</strong></span><b>Learn more</b></div>
    <div className="hc-ce-proof"><span><i><ThumbsUp aria-hidden="true" size={9} fill="currentColor" /></i>{example.reactions}</span><span>{example.comments} comments</span></div>
    <div className="hc-ce-actions" aria-hidden="true"><span><ThumbsUp size={15} />Like</span><span><MessageCircle size={15} />Comment</span><span><Share2 size={15} />Share</span></div>
  </article>;
}

export function CreativeEditPreview({ selectedExample }: CreativeEditPreviewProps) {
  const index = Number.isFinite(selectedExample) ? Math.min(Math.max(Math.trunc(selectedExample), 0), 3) : 0;
  const example = CREATIVE_EDIT_EXAMPLES[index];
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(motion.matches);
    const syncVisibility = () => setVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    syncMotion();
    syncVisibility();
    if (ref.current) observer.observe(ref.current);
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  const play = inView && visible && !reduced;
  useEffect(() => { elapsedRef.current = 0; setElapsed(null); }, [index]);
  useEffect(() => {
    if (reduced) { setElapsed(null); return; }
    if (!play) return;
    let previous = performance.now();
    setElapsed(elapsedRef.current);
    const timer = window.setInterval(() => {
      const now = performance.now();
      elapsedRef.current += now - previous;
      previous = now;
      setElapsed(elapsedRef.current);
    }, 50);
    return () => window.clearInterval(timer);
  }, [play, reduced, index]);
  return <div ref={ref} className="hc-creative-edit-preview"><MetaFeed example={example} elapsed={elapsed} /></div>;
}
