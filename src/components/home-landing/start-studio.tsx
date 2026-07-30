"use client";

import { useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

import { CtaLink } from "@/components/landing/cta-link";

import { START_TEMPLATES } from "./data";
import { FbAdCard } from "./fb-ad-card";

/**
 * #start — the interactive studio band.
 *
 * One starting point in, one live ad out. A single strip of curated templates
 * feeds the preview. Selecting any card animates the preview to that ad — the
 * "pick a layout, watch yours appear" loop that anchors the page.
 *
 * Motion thesis: the preview swap on selection is the one authored moment
 * (AnimatePresence crossfade). Entrance and hover are quiet support. All
 * motion honors prefers-reduced-motion via MotionConfig.
 */

/** One selectable starting point — a curated template. */
type StartPick = {
  id: string;
  label: string;
  imageSrc: string;
  copy: string;
  footHeading: string;
  footSub?: string;
};

const TEMPLATES: StartPick[] = START_TEMPLATES.map((t) => ({
  id: t.id,
  label: t.label,
  imageSrc: t.imageSrc,
  copy: t.copy,
  footHeading: t.footHeading,
  footSub: t.footSub,
}));

/** Confident deceleration shared by the band (matches --hw-ease). */
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Stagger container: children cascade in as the strip enters the viewport. */
const stripVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export function StartStudio() {
  const [selectedId, setSelectedId] = useState<string>(TEMPLATES[0].id);
  const selected = TEMPLATES.find((p) => p.id === selectedId) ?? TEMPLATES[0];

  return (
    <MotionConfig reducedMotion="user">
      <div className="hw-studio">
        <div className="hw-wide hw-studio-grid">
          {/* ---- Heading ---- */}
            <motion.div
              className="hw-studio-heading"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.55, ease: EASE_OUT }}
            >
              <h2>Don&rsquo;t start from a blank page.</h2>
              <p className="hw-sub">Pick a layout. Add your own photos and copy.</p>
            </motion.div>

            <div className="hw-studio-group hw-studio-group--templates">
              <p className="hw-studio-group-label">Use a template</p>
              <motion.div
                className="hw-studio-templates"
                variants={stripVariants}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.15 }}
              >
                {TEMPLATES.map((t) => {
                  const active = t.id === selectedId;
                  return (
                    <motion.button
                      key={t.id}
                      type="button"
                      variants={cardVariants}
                      className={`hw-studio-card${active ? " is-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <span className="hw-studio-card-thumb" aria-hidden>
                        <img src={t.imageSrc} alt="" loading="lazy" />
                      </span>
                      <span className="hw-studio-card-label">{t.label}</span>
                    </motion.button>
                  );
                })}
              </motion.div>
            </div>

          {/* ---- Right: the live preview ---- */}
          <div className="hw-studio-side">
            <motion.div
              className="hw-studio-preview"
              initial={{ opacity: 0, y: 26 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={selected.id}
                  className="hw-studio-ad"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } }}
                  exit={{ opacity: 0, y: -8, transition: { duration: 0.16, ease: "easeIn" } }}
                >
                  <FbAdCard
                    copy={selected.copy}
                    photoSrc={selected.imageSrc}
                    photoAlt={`${selected.label} example ad`}
                    domain="YOURAGENCY.COM.AU"
                    footHeading={selected.footHeading}
                    footSub={selected.footSub}
                  />
                </motion.div>
              </AnimatePresence>

              <CtaLink
                location="start_studio"
                href="/signup"
                className="hw-btn hw-btn--dark hw-studio-cta"
              >
                Create three ads free <span className="hw-arr">→</span>
              </CtaLink>
              <p className="hw-note">Nothing spends until you approve.</p>
            </motion.div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
