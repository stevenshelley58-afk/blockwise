import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Globe2, MoreHorizontal, ThumbsUp } from "lucide-react";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { DemoForm } from "@/components/landing/demo-form";
import { SignInLink } from "@/components/landing/sign-in-link";
import { LandingAdRadarScan } from "@/components/research/landing-ad-radar-scan";
import { LandingRadarCards } from "@/components/research/landing-radar-cards";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Landing page — "Executive Precision" design (source: /stitch export, wired
 * to real app flows). Copy is freely editable.
 */

type FeatureProps = { title: string; copy: string; icon: React.ReactNode };

function Feature({ title, copy, icon }: FeatureProps) {
  return (
    <article className="lp-feature">
      <div className="lp-feature-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

/** Scoped styles for the #workflow "wasted time" flow section (flow- namespaced). */
const FLOW_CSS = `
.lp-flow {
  --flow-ink: #071329;
  --flow-muted: #647187;
  --flow-line: #dfe7f2;
  --flow-blue: #1677ff;
  --flow-teal: #20b8b0;
  --flow-green: #17aa6b;
  --flow-gold: #d9a21b;
  --flow-shadow: 0 24px 76px rgba(15, 32, 64, 0.10);
  --flow-shadow-sm: 0 12px 34px rgba(15, 32, 64, 0.08);
  --flow-radius: 28px;
}
.lp-flow *,
.lp-flow *::before,
.lp-flow *::after { box-sizing: border-box; }
.lp-flow .flow-kicker {
  margin: 0;
  text-align: center;
  color: var(--flow-blue);
  font-weight: 850;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
.lp-flow .flow-h2 {
  text-align: center;
  margin: 16px auto 0;
  max-width: 820px;
  font-size: clamp(34px, 4.2vw, 54px);
  line-height: 1.05;
  letter-spacing: -0.055em;
  color: var(--flow-ink);
}
.lp-flow .flow-sub {
  text-align: center;
  margin: 22px auto 44px;
  max-width: 740px;
  color: var(--flow-muted);
  font-size: 20px;
  line-height: 1.55;
}
.lp-flow .flow-panel {
  border: 1px solid var(--flow-line);
  border-radius: var(--flow-radius);
  background:
    radial-gradient(circle at 18% 18%, rgba(32, 184, 176, 0.13), transparent 32%),
    radial-gradient(circle at 88% 78%, rgba(22, 119, 255, 0.10), transparent 34%),
    linear-gradient(140deg, #f8fbff, #ffffff 52%, #f5fbfb);
  box-shadow: var(--flow-shadow);
  position: relative;
  overflow: hidden;
}
.lp-flow .flow-workflow {
  padding: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(330px, 420px) minmax(0, 1fr);
  gap: 24px;
  align-items: stretch;
}
.lp-flow .flow-col {
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
  min-height: 548px;
}
.lp-flow .flow-zone-title {
  margin: 0;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-weight: 900;
  color: #728096;
  white-space: nowrap;
}
.lp-flow .flow-card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(206, 217, 234, 0.92);
  border-radius: 22px;
  box-shadow: var(--flow-shadow-sm);
}
.lp-flow .flow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.lp-flow .flow-small { font-size: 13px; color: var(--flow-muted); line-height: 1.35; }
.lp-flow .flow-pill {
  border-radius: 999px;
  padding: 7px 10px;
  background: #eef5ff;
  color: #1f62b8;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}
.lp-flow .flow-pill.green { background: #eafaf3; color: #0c8958; }
.lp-flow .flow-pill.teal { background: #e9fbfa; color: #087c78; }
.lp-flow .flow-primary-btn {
  border: 0;
  border-radius: 14px;
  padding: 13px 16px;
  background: var(--flow-ink);
  color: #ffffff;
  font-weight: 900;
  cursor: pointer;
}
.lp-flow .flow-task-stack { position: relative; min-height: 0; height: 100%; }
.lp-flow .flow-task-card {
  position: absolute;
  width: 260px;
  min-height: 92px;
  display: grid;
  gap: 7px;
  padding: 16px 17px;
  border-radius: 19px;
  background: #ffffff;
  border: 1px solid #dfe7f3;
  box-shadow: 0 14px 30px rgba(18, 34, 64, 0.08);
  animation: flowTaskFloat 5.8s ease-in-out infinite;
}
.lp-flow .flow-task-card strong {
  font-size: 16px;
  line-height: 1.15;
  letter-spacing: -0.035em;
  color: var(--flow-ink);
}
.lp-flow .flow-task-card span { font-size: 13px; color: #7a879b; }
.lp-flow .flow-task-card .flow-warn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 900;
  color: #9a4b00;
  background: #fff7e5;
  border-radius: 999px;
  padding: 6px 8px;
  width: max-content;
}
.lp-flow .flow-task-card .flow-warn::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--flow-gold);
}
.lp-flow .flow-task-card:nth-child(1) { left: 0; top: 0; rotate: -1deg; }
.lp-flow .flow-task-card:nth-child(2) { left: 72px; top: 86px; rotate: 1deg; animation-delay: 0.2s; }
.lp-flow .flow-task-card:nth-child(3) { left: 14px; top: 172px; rotate: -0.7deg; animation-delay: 0.4s; }
.lp-flow .flow-task-card:nth-child(4) { left: 84px; top: 258px; rotate: 1deg; animation-delay: 0.6s; }
.lp-flow .flow-task-card:nth-child(5) { left: 25px; top: 344px; rotate: -0.8deg; animation-delay: 0.8s; }
@keyframes flowTaskFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.lp-flow .flow-arrow {
  position: absolute;
  right: -10px;
  top: 252px;
  width: 72px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--flow-teal));
}
.lp-flow .flow-arrow::after {
  content: "";
  position: absolute;
  right: -2px;
  top: -5px;
  width: 12px;
  height: 12px;
  border-top: 2px solid var(--flow-teal);
  border-right: 2px solid var(--flow-teal);
  transform: rotate(45deg);
}
.lp-flow .flow-review {
  padding: 22px;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.lp-flow .flow-review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.lp-flow .flow-preview-box {
  height: 82px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(22, 119, 255, 0.95), rgba(32, 184, 176, 0.95));
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
}
.lp-flow .flow-preview-box::before {
  content: "Free appraisal";
  position: absolute;
  left: 18px;
  bottom: 17px;
  color: #ffffff;
  font-weight: 950;
  font-size: 21px;
  letter-spacing: -0.05em;
}
.lp-flow .flow-preview-box::after {
  content: "";
  position: absolute;
  inset: auto -22px -44px 46%;
  height: 82px;
  background: rgba(255, 255, 255, 0.23);
  border-radius: 50%;
}
.lp-flow .flow-fields { display: grid; gap: 0; margin: 8px 0 16px; }
.lp-flow .flow-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #edf1f7;
  padding: 13px 0;
}
.lp-flow .flow-field strong { font-size: 17px; letter-spacing: -0.035em; color: var(--flow-ink); }
.lp-flow .flow-approve {
  width: 100%;
  margin-top: auto;
  min-height: 52px;
  animation: flowApproveState 6.2s ease-in-out infinite;
}
@keyframes flowApproveState {
  0%, 63%, 100% { background: var(--flow-ink); }
  74%, 92% { background: var(--flow-green); }
}
.lp-flow .flow-daily {
  padding: 22px;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.lp-flow .flow-daily-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.lp-flow .flow-daily-head h3 { margin: 0; font-size: 21px; letter-spacing: -0.04em; color: var(--flow-ink); }
.lp-flow .flow-metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}
.lp-flow .flow-metric {
  min-height: 105px;
  padding: 16px;
  border-radius: 18px;
  background: #f5f8fd;
  border: 1px solid #e4ebf5;
}
.lp-flow .flow-metric b {
  display: block;
  margin-top: 8px;
  font-size: 31px;
  letter-spacing: -0.07em;
  color: var(--flow-ink);
}
.lp-flow .flow-summary {
  border-top: 1px solid #edf1f7;
  padding-top: 16px;
  margin-top: 2px;
}
.lp-flow .flow-summary strong { font-size: 17px; letter-spacing: -0.035em; color: var(--flow-ink); }
.lp-flow .flow-email-preview {
  margin-top: 18px;
  padding: 15px;
  border-radius: 18px;
  background: #f6f9fd;
  border: 1px solid #e4ebf5;
}
.lp-flow .flow-email-preview strong {
  display: block;
  margin-bottom: 6px;
  letter-spacing: -0.03em;
  color: var(--flow-ink);
}
.lp-flow .flow-email-line {
  height: 8px;
  border-radius: 999px;
  background: #dfe7f2;
  margin-top: 9px;
}
.lp-flow .flow-email-line:nth-child(3) { width: 82%; }
.lp-flow .flow-email-line:nth-child(4) { width: 58%; }
.lp-flow .flow-update-note {
  margin: 0;
  margin-top: auto;
  padding-top: 16px;
  color: var(--flow-muted);
  font-size: 13px;
  line-height: 1.35;
}
.lp-flow .flow-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
  margin-top: 28px;
}
.lp-flow .flow-step {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: flex-start;
}
.lp-flow .flow-num {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  color: #ffffff;
  font-weight: 950;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--flow-blue), var(--flow-teal));
  box-shadow: 0 10px 20px rgba(32, 184, 176, 0.2);
}
.lp-flow .flow-step h3 { margin: 1px 0 8px; font-size: 20px; letter-spacing: -0.03em; color: var(--flow-ink); }
.lp-flow .flow-step p { margin: 0; color: var(--flow-muted); line-height: 1.45; font-size: 16px; }
.lp-flow .flow-cta-row { margin-top: 40px; display: flex; justify-content: center; }
.lp-flow .flow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 16px;
  background: var(--flow-blue);
  color: #ffffff;
  padding: 14px 22px;
  font-size: 15px;
  font-weight: 850;
  text-decoration: none;
  white-space: nowrap;
  box-shadow: 0 12px 26px rgba(22, 119, 255, 0.22);
  transition: background 0.15s ease, scale 0.12s ease;
}
.lp-flow .flow-btn:hover { background: #0f63e6; }
.lp-flow .flow-btn:active { scale: 0.96; }
@media (max-width: 1080px) {
  .lp-flow .flow-workflow { grid-template-columns: 1fr; padding: 22px; }
  .lp-flow .flow-col { grid-template-rows: auto 1fr; min-height: auto; }
  .lp-flow .flow-zone-title { height: auto; white-space: normal; justify-content: flex-start; text-align: left; }
  .lp-flow .flow-task-stack { min-height: auto; display: grid; gap: 10px; }
  .lp-flow .flow-task-card {
    position: relative;
    width: auto;
    min-height: auto;
    left: auto !important;
    top: auto !important;
    rotate: 0deg !important;
    animation: none !important;
  }
  .lp-flow .flow-arrow { display: none; }
  .lp-flow .flow-review,
  .lp-flow .flow-daily { min-height: auto; }
}
@media (max-width: 820px) {
  .lp-flow .flow-h2 { text-align: left; font-size: 38px; }
  .lp-flow .flow-sub { text-align: left; font-size: 17px; margin-bottom: 28px; }
  .lp-flow .flow-kicker { text-align: left; }
  .lp-flow .flow-steps { grid-template-columns: 1fr; gap: 18px; }
  .lp-flow .flow-metric-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .lp-flow *,
  .lp-flow *::before,
  .lp-flow *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}

/* Attached compact workflow replacement. */
.lp-flow {
  --flow-ink: #051126;
  --flow-muted: #657187;
  --flow-line: #dfe7f2;
  --flow-blue: #4e7ce7;
  --flow-teal: #5bbdb5;
  --flow-purple: #7658ea;
  background: #ffffff;
  padding: 110px 0 102px;
}
.lp-flow .flow-shell {
  width: min(1536px, calc(100% - 96px));
  margin: 0 auto;
}
.lp-flow .flow-intro {
  margin: 0 auto;
  max-width: 800px;
  text-align: center;
}
.lp-flow .flow-h2 {
  margin: 0;
  max-width: none;
  color: var(--flow-ink);
  font-size: 42px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: 0;
  text-align: center;
}
.lp-flow .flow-h2 span { display: block; }
.lp-flow .flow-sub {
  margin: 26px auto 0;
  max-width: 770px;
  color: var(--flow-muted);
  font-size: 24px;
  line-height: 1.45;
  letter-spacing: 0;
  text-align: center;
}
.lp-flow .flow-panel {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 402px;
  margin-top: 72px;
  overflow: hidden;
  border: 1px solid var(--flow-line);
  border-radius: 34px;
  background: linear-gradient(135deg, #f8fbff 0%, #ffffff 46%, #f6f3ff 100%);
  box-shadow: none;
}
.lp-flow .flow-track {
  position: relative;
  width: min(1120px, 78%);
  min-height: 222px;
}
.lp-flow .flow-path {
  position: absolute;
  top: 58px;
  right: 110px;
  left: 98px;
  height: 132px;
  overflow: visible;
}
.lp-flow .flow-radar {
  position: absolute;
  top: 20px;
  left: 0;
  width: 204px;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 22px 54px rgba(35, 58, 92, 0.11);
}
.lp-flow .flow-radar::before,
.lp-flow .flow-radar::after,
.lp-flow .flow-radar-ring {
  content: "";
  position: absolute;
  border-radius: 50%;
  border: 2px solid rgba(91, 189, 181, 0.28);
}
.lp-flow .flow-radar::before { inset: 16px; }
.lp-flow .flow-radar::after { inset: 48px; }
.lp-flow .flow-radar-ring { inset: 76px; }
.lp-flow .flow-radar-sweep {
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  background: conic-gradient(from -46deg, rgba(91, 189, 181, 0.3) 0 44deg, transparent 45deg 360deg);
}
.lp-flow .flow-radar-dot {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6c95e7;
}
.lp-flow .flow-radar-dot-one { top: 32px; left: 116px; }
.lp-flow .flow-radar-dot-two { top: 108px; left: 36px; }
.lp-flow .flow-radar-core {
  position: absolute;
  top: 96px;
  left: 96px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--flow-teal);
}
.lp-flow .flow-prepared-card {
  position: absolute;
  top: 52px;
  left: 50%;
  width: 144px;
  min-height: 144px;
  transform: translateX(-50%);
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(31, 52, 83, 0.12);
  padding: 18px 20px;
}
.lp-flow .flow-prepared-creative {
  height: 42px;
  border-radius: 9px;
  background: linear-gradient(135deg, #5b8bf1, #3468d8);
}
.lp-flow .flow-prepared-line {
  height: 7px;
  margin-top: 10px;
  border-radius: 999px;
  background: #dfe4ec;
}
.lp-flow .flow-prepared-line-short { width: 68%; }
.lp-flow .flow-ready-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 59px;
  margin-top: 12px;
  border-radius: 999px;
  background: var(--flow-teal);
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  padding: 6px 10px;
}
.lp-flow .flow-node-dot {
  position: absolute;
  right: 312px;
  top: 142px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--flow-teal);
}
.lp-flow .flow-results-card {
  position: absolute;
  top: 46px;
  right: 0;
  width: 240px;
  min-height: 156px;
  border-radius: 21px;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(31, 52, 83, 0.13);
  padding: 20px 22px 18px;
}
.lp-flow .flow-results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.lp-flow .flow-results-label {
  color: #8a93a4;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}
.lp-flow .flow-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #429d66;
  font-size: 12px;
  font-weight: 800;
}
.lp-flow .flow-live::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4da66b;
}
.lp-flow .flow-results-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 17px;
}
.lp-flow .flow-result + .flow-result {
  border-left: 1px solid #e6ebf3;
  padding-left: 20px;
}
.lp-flow .flow-result-number {
  display: block;
  color: #050a16;
  font-size: 40px;
  font-weight: 850;
  line-height: 1;
  letter-spacing: 0;
}
.lp-flow .flow-result-label {
  display: block;
  margin-top: 6px;
  color: #727b8d;
  font-size: 14px;
  line-height: 1.15;
}
.lp-flow .flow-sparkline {
  display: block;
  width: 154px;
  height: 24px;
  margin-top: 10px;
}
.lp-flow .flow-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 44px;
  margin-top: 38px;
}
.lp-flow .flow-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 15px;
}
.lp-flow .flow-step > div { text-align: left; }
.lp-flow .flow-num {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #ffffff;
  font-size: 18px;
  font-weight: 850;
  line-height: 1;
  box-shadow: none;
}
.lp-flow .flow-num-blue { background: var(--flow-blue); }
.lp-flow .flow-num-teal { background: var(--flow-teal); }
.lp-flow .flow-num-purple { background: var(--flow-purple); }
.lp-flow .flow-step h3 {
  margin: 2px 0 12px;
  color: var(--flow-ink);
  font-size: 25px;
  font-weight: 850;
  line-height: 1.1;
  letter-spacing: 0;
}
.lp-flow .flow-step p {
  margin: 0;
  color: #263653;
  font-size: 22px;
  line-height: 1.35;
}
@media (max-width: 1100px) {
  .lp-flow .flow-shell { width: min(100% - 48px, 960px); }
  .lp-flow .flow-panel { min-height: 360px; }
  .lp-flow .flow-track { width: min(920px, 88%); }
  .lp-flow .flow-radar { width: 176px; top: 30px; }
  .lp-flow .flow-prepared-card { width: 132px; min-height: 132px; top: 60px; }
  .lp-flow .flow-results-card { width: 216px; }
  .lp-flow .flow-node-dot { right: 276px; }
}
@media (max-width: 860px) {
  .lp-flow { padding: 70px 0 78px; }
  .lp-flow .flow-shell { width: min(100% - 32px, 680px); }
  .lp-flow .flow-intro,
  .lp-flow .flow-h2,
  .lp-flow .flow-sub { text-align: left; }
  .lp-flow .flow-h2 { font-size: 34px; line-height: 1.18; }
  .lp-flow .flow-sub { font-size: 18px; margin-top: 20px; }
  .lp-flow .flow-panel {
    min-height: 0;
    margin-top: 36px;
    padding: 30px 20px;
    border-radius: 26px;
    place-items: stretch;
  }
  .lp-flow .flow-track {
    display: grid;
    width: 100%;
    min-height: 0;
    gap: 18px;
    justify-items: center;
  }
  .lp-flow .flow-path,
  .lp-flow .flow-node-dot { display: none; }
  .lp-flow .flow-radar,
  .lp-flow .flow-prepared-card,
  .lp-flow .flow-results-card {
    position: relative;
    top: auto;
    right: auto;
    left: auto;
    transform: none;
  }
  .lp-flow .flow-radar { width: 180px; }
  .lp-flow .flow-steps { grid-template-columns: 1fr; gap: 24px; margin-top: 32px; }
  .lp-flow .flow-step p { font-size: 18px; }
}
@media (max-width: 520px) {
  .lp-flow .flow-h2 { font-size: 30px; }
  .lp-flow .flow-h2 span { display: inline; }
  .lp-flow .flow-h2 span + span::before { content: " "; }
  .lp-flow .flow-results-card { width: 100%; max-width: 240px; }
  .lp-flow .flow-step h3 { font-size: 22px; }
}

/* Attached workload board replacement. */
.lp-flow {
  --flow-ink: #071329;
  --flow-muted: #647187;
  --flow-line: #dfe7f2;
  --flow-blue: #1677ff;
  --flow-teal: #20b8b0;
  --flow-green: #17aa6b;
  --flow-gold: #d9a21b;
  --flow-shadow: 0 24px 76px rgba(15, 32, 64, 0.10);
  --flow-shadow-sm: 0 12px 34px rgba(15, 32, 64, 0.08);
  background: linear-gradient(120deg, #f5fbfd 0%, #ffffff 48%, #f4f8fb 100%);
  padding: 56px 0 52px;
  overflow: hidden;
}
.lp-flow .flow-shell {
  width: min(1680px, calc(100% - 76px));
  margin: 0 auto;
}
.lp-flow .flow-panel {
  display: block;
  min-height: 0;
  margin: 0;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.lp-flow .flow-workflow {
  display: grid;
  grid-template-columns: minmax(430px, 1fr) minmax(540px, 630px) minmax(420px, 480px);
  gap: 36px;
  align-items: stretch;
  padding: 0;
}
.lp-flow .flow-col {
  display: grid;
  grid-template-rows: 28px 778px;
  gap: 25px;
  min-width: 0;
  min-height: 0;
}
.lp-flow .flow-zone-title {
  height: 28px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #728096;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  text-align: center;
  text-transform: uppercase;
  white-space: nowrap;
}
.lp-flow .flow-card {
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(206, 217, 234, 0.96);
  border-radius: 30px;
  box-shadow: var(--flow-shadow-sm);
}
.lp-flow .flow-task-stack {
  position: relative;
  min-height: 0;
  height: 100%;
}
.lp-flow .flow-task-card {
  position: absolute;
  width: 388px;
  min-height: 136px;
  display: grid;
  gap: 12px;
  padding: 28px 26px;
  border: 1px solid #dfe7f3;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(18, 34, 64, 0.08);
  animation: none;
}
.lp-flow .flow-task-card strong {
  color: var(--flow-ink);
  font-size: 24px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1.1;
}
.lp-flow .flow-task-card span {
  color: #8a96a9;
  font-size: 20px;
  line-height: 1.25;
}
.lp-flow .flow-task-card .flow-warn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  border-radius: 999px;
  background: #fff7e5;
  color: #8a4a10;
  font-size: 17px;
  font-weight: 850;
  line-height: 1;
  padding: 11px 14px;
}
.lp-flow .flow-task-card .flow-warn::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--flow-gold);
}
.lp-flow .flow-task-card:nth-child(1) { left: 0; top: 0; rotate: -1deg; }
.lp-flow .flow-task-card:nth-child(2) { left: 108px; top: 126px; rotate: 1deg; }
.lp-flow .flow-task-card:nth-child(3) { left: 22px; top: 250px; rotate: -0.7deg; }
.lp-flow .flow-task-card:nth-child(4) { left: 128px; top: 376px; rotate: 1deg; }
.lp-flow .flow-task-card:nth-child(5) { left: 38px; top: 500px; rotate: -0.8deg; }
.lp-flow .flow-arrow {
  position: absolute;
  right: -14px;
  top: 384px;
  width: 72px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--flow-teal));
}
.lp-flow .flow-arrow::after {
  content: "";
  position: absolute;
  right: -2px;
  top: -6px;
  width: 14px;
  height: 14px;
  border-top: 2px solid var(--flow-teal);
  border-right: 2px solid var(--flow-teal);
  transform: rotate(45deg);
}
.lp-flow .flow-review,
.lp-flow .flow-daily {
  min-height: 0;
  height: 100%;
  padding: 34px;
  display: flex;
  flex-direction: column;
}
.lp-flow .flow-review-head,
.lp-flow .flow-daily-head,
.lp-flow .flow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.lp-flow .flow-review-head { margin-bottom: 28px; }
.lp-flow .flow-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 12px 16px;
  font-size: 17px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1;
  white-space: nowrap;
}
.lp-flow .flow-pill.green { background: #eafaf3; color: #2e7d55; }
.lp-flow .flow-pill.teal { background: #e9fbfa; color: #246c69; }
.lp-flow .flow-preview-box {
  height: 124px;
  margin-bottom: 36px;
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(22, 119, 255, 0.95), rgba(32, 184, 176, 0.95));
}
.lp-flow .flow-preview-box::before {
  content: "Free appraisal";
  position: absolute;
  left: 28px;
  bottom: 31px;
  color: #ffffff;
  font-size: 30px;
  font-weight: 950;
  letter-spacing: 0;
}
.lp-flow .flow-preview-box::after {
  content: "";
  position: absolute;
  inset: auto -24px -52px 46%;
  height: 110px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.23);
}
.lp-flow .flow-fields {
  display: grid;
  gap: 0;
  margin: 0 0 20px;
}
.lp-flow .flow-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid #edf1f7;
  padding: 19px 0;
}
.lp-flow .flow-small {
  color: var(--flow-muted);
  font-size: 20px;
  line-height: 1.35;
}
.lp-flow .flow-field strong,
.lp-flow .flow-summary strong {
  color: var(--flow-ink);
  font-size: 24px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1.1;
}
.lp-flow .flow-primary-btn {
  border: 0;
  border-radius: 18px;
  cursor: pointer;
  font-weight: 900;
}
.lp-flow .flow-approve {
  width: 100%;
  min-height: 78px;
  margin-top: auto;
  background: #4da66b;
  color: #ffffff;
  font-size: 24px;
  animation: none;
}
.lp-flow .flow-daily-head {
  margin-bottom: 36px;
}
.lp-flow .flow-daily-head h3 {
  margin: 0;
  color: var(--flow-ink);
  font-size: 30px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1.1;
}
.lp-flow .flow-metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-bottom: 28px;
}
.lp-flow .flow-metric {
  min-height: 158px;
  padding: 34px 26px;
  border: 1px solid #e4ebf5;
  border-radius: 28px;
  background: #f5f8fd;
}
.lp-flow .flow-metric b {
  display: block;
  margin-top: 20px;
  color: var(--flow-ink);
  font-size: 48px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1;
}
.lp-flow .flow-summary {
  border-top: 1px solid #edf1f7;
  margin-top: 0;
  padding-top: 28px;
}
.lp-flow .flow-summary p {
  margin: 24px 0 0;
}
.lp-flow .flow-email-preview {
  margin-top: 34px;
  padding: 24px;
  border: 1px solid #e4ebf5;
  border-radius: 28px;
  background: #f6f9fd;
}
.lp-flow .flow-email-preview strong {
  display: block;
  margin-bottom: 18px;
  color: var(--flow-ink);
  font-size: 24px;
  font-weight: 850;
  letter-spacing: 0;
}
.lp-flow .flow-email-preview .flow-small {
  font-size: 18px;
  line-height: 1.25;
}
.lp-flow .flow-email-line {
  height: 13px;
  margin-top: 14px;
  border-radius: 999px;
  background: #dfe7f2;
}
.lp-flow .flow-email-line:nth-child(3) { width: 82%; }
.lp-flow .flow-email-line:nth-child(4) { width: 58%; }
.lp-flow .flow-update-note {
  margin: auto 0 0;
  padding-top: 22px;
  color: var(--flow-muted);
  font-size: 18px;
  line-height: 1.32;
}
@media (max-width: 1280px) {
  .lp-flow .flow-shell { width: min(1180px, calc(100% - 48px)); }
  .lp-flow .flow-workflow {
    grid-template-columns: minmax(0, 1fr) minmax(330px, 420px) minmax(0, 1fr);
    gap: 24px;
  }
  .lp-flow .flow-col {
    grid-template-rows: 32px minmax(0, 1fr);
    gap: 18px;
    min-height: 548px;
  }
  .lp-flow .flow-task-card {
    width: 260px;
    min-height: 92px;
    gap: 7px;
    padding: 16px 17px;
    border-radius: 19px;
  }
  .lp-flow .flow-task-card strong { font-size: 16px; }
  .lp-flow .flow-task-card span { font-size: 13px; }
  .lp-flow .flow-task-card .flow-warn { gap: 7px; font-size: 11px; padding: 6px 8px; }
  .lp-flow .flow-task-card .flow-warn::before { width: 7px; height: 7px; }
  .lp-flow .flow-task-card:nth-child(1) { left: 0; top: 0; }
  .lp-flow .flow-task-card:nth-child(2) { left: 72px; top: 86px; }
  .lp-flow .flow-task-card:nth-child(3) { left: 14px; top: 172px; }
  .lp-flow .flow-task-card:nth-child(4) { left: 84px; top: 258px; }
  .lp-flow .flow-task-card:nth-child(5) { left: 25px; top: 344px; }
  .lp-flow .flow-arrow { right: -10px; top: 252px; }
  .lp-flow .flow-review,
  .lp-flow .flow-daily { padding: 22px; }
  .lp-flow .flow-pill { padding: 7px 10px; font-size: 12px; }
  .lp-flow .flow-preview-box { height: 82px; margin-bottom: 16px; border-radius: 18px; }
  .lp-flow .flow-preview-box::before { left: 18px; bottom: 17px; font-size: 21px; }
  .lp-flow .flow-field { padding: 13px 0; }
  .lp-flow .flow-field strong,
  .lp-flow .flow-summary strong { font-size: 17px; }
  .lp-flow .flow-small { font-size: 13px; }
  .lp-flow .flow-email-preview .flow-small { font-size: 13px; }
  .lp-flow .flow-approve { min-height: 52px; font-size: 16px; }
  .lp-flow .flow-daily-head { margin-bottom: 20px; }
  .lp-flow .flow-daily-head h3 { font-size: 21px; }
  .lp-flow .flow-metric { min-height: 105px; padding: 16px; border-radius: 18px; }
  .lp-flow .flow-metric b { margin-top: 8px; font-size: 31px; }
  .lp-flow .flow-email-preview { margin-top: 18px; padding: 15px; border-radius: 18px; }
  .lp-flow .flow-email-preview strong { margin-bottom: 6px; font-size: 16px; }
  .lp-flow .flow-email-line { height: 8px; margin-top: 9px; }
  .lp-flow .flow-update-note { padding-top: 16px; font-size: 13px; }
}
@media (max-width: 1080px) {
  .lp-flow .flow-workflow { grid-template-columns: 1fr; }
  .lp-flow .flow-col {
    grid-template-rows: auto 1fr;
    min-height: auto;
  }
  .lp-flow .flow-zone-title {
    height: auto;
    justify-content: flex-start;
    text-align: left;
    white-space: normal;
  }
  .lp-flow .flow-task-stack {
    display: grid;
    gap: 10px;
    min-height: auto;
  }
  .lp-flow .flow-task-card {
    position: relative;
    left: auto !important;
    top: auto !important;
    width: auto;
    min-height: auto;
    rotate: 0deg !important;
  }
  .lp-flow .flow-arrow { display: none; }
}
@media (max-width: 720px) {
  .lp-flow {
    padding: 46px 0 58px;
  }
  .lp-flow .flow-shell {
    width: min(100% - 32px, 680px);
  }
  .lp-flow .flow-zone-title {
    font-size: 13px;
  }
  .lp-flow .flow-metric-grid {
    grid-template-columns: 1fr;
  }
}
`;

const READY_MADE_ADS = [
  {
    id: "just-listed",
    title: "Just Listed",
    description: "Promote a new property.",
    postText: "Just listed in Subiaco: a light-filled townhouse close to cafes, parks and the train line.",
    badge: "JUST LISTED",
    creativeHeadline: "Subiaco townhouse",
    creativeSubline: "3 bed - 2 bath - inspect this week",
    location: "Subiaco",
    domain: "BLOCKWISE.SALE",
    linkHeadline: "Fresh listing ready for buyers",
    linkDescription: "View inspection times and property details.",
    cta: "Learn more",
    reactions: "142",
    image: "/adstudio-samples/generated-au-properties/au-urban-townhouse.png",
  },
  {
    id: "open-home",
    title: "Open Home",
    description: "Drive inspection traffic.",
    postText: "Open this Saturday in Cottesloe. Save the inspection time and send through any questions before you arrive.",
    badge: "OPEN HOME",
    creativeHeadline: "Saturday 11:00am",
    creativeSubline: "4 bed coastal home - register interest",
    location: "Cottesloe",
    domain: "BLOCKWISE.SALE",
    linkHeadline: "Open home times for Cottesloe",
    linkDescription: "See the address, photos and inspection window.",
    cta: "Book inspection",
    reactions: "98",
    image: "/adstudio-samples/generated-au-properties/au-coastal-luxury.jpg",
  },
  {
    id: "just-sold",
    title: "Just Sold",
    description: "Show local proof.",
    postText: "Another Mount Hawthorn sale is wrapped. See the recent local results before you plan your next move.",
    badge: "JUST SOLD",
    creativeHeadline: "Sold in Mount Hawthorn",
    creativeSubline: "Recent result report now available",
    location: "Mount Hawthorn",
    domain: "BLOCKWISE.SALE",
    linkHeadline: "Recent sales near your home",
    linkDescription: "Compare nearby results before you list.",
    cta: "View results",
    reactions: "211",
    image: "/adstudio-samples/generated-au-properties/au-character-cottage.jpg",
  },
  {
    id: "free-appraisal",
    title: "Free Appraisal",
    description: "Find seller leads.",
    postText: "Thinking of selling in Mount Lawley? Get a local appraisal before your next move.",
    badge: "FREE APPRAISAL",
    creativeHeadline: "What could your home sell for?",
    creativeSubline: "A suburb-specific view before you decide",
    location: "Mount Lawley",
    domain: "BLOCKWISE.SALE",
    linkHeadline: "What could your home sell for?",
    linkDescription: "Get a suburb-specific view before you decide.",
    cta: "Book now",
    reactions: "126",
    image: "/adstudio-samples/generated-au-properties/au-modern-coastal.png",
  },
  {
    id: "buyer-demand",
    title: "Buyer Demand",
    description: "Turn demand into vendor interest.",
    postText: "Owners in Leederville are asking what buyer demand looks like right now. Start with a local demand check.",
    badge: "BUYER DEMAND",
    creativeHeadline: "Are buyers watching your street?",
    creativeSubline: "Local enquiry signals for owners",
    location: "Leederville",
    domain: "BLOCKWISE.SALE",
    linkHeadline: "Check buyer demand in your area",
    linkDescription: "See whether your suburb is attracting active interest.",
    cta: "Check demand",
    reactions: "174",
    image: "/adstudio-samples/generated-au-properties/au-brick-family-home.jpg",
  },
  {
    id: "market-update",
    title: "Market Update",
    description: "Stay visible in your area.",
    postText: "The Fremantle market is moving. Get the latest local update on recent sales, demand and listing activity.",
    badge: "MARKET UPDATE",
    creativeHeadline: "Fremantle property update",
    creativeSubline: "Recent sales - demand - listing signals",
    location: "Fremantle",
    domain: "BLOCKWISE.SALE",
    linkHeadline: "Get the local market update",
    linkDescription: "A clear suburb snapshot for owners.",
    cta: "Get update",
    reactions: "156",
    image: "/adstudio-samples/generated-au-properties/au-riverside-townhouse.jpg",
  },
] as const;

const READY_MADE_ADS_CSS = `
.lp-ad-showcase {
  background: #f7f9fc;
  border-top: 1px solid #e8edf4;
  border-bottom: 1px solid #e8edf4;
  padding: 78px 0 86px;
}
.lp-ad-showcase * { box-sizing: border-box; }
.lp-ad-switcher {
  display: grid;
  grid-template-columns: minmax(320px, 560px) minmax(330px, 460px);
  gap: 92px;
  align-items: center;
  justify-content: center;
}
.lp-ad-radio {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.lp-ad-options {
  display: grid;
  gap: 16px;
}
.lp-ad-option {
  min-height: 82px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  align-items: center;
  gap: 18px;
  padding: 18px 22px;
  border: 1px solid #e1e7f0;
  border-radius: 8px;
  background: #ffffff;
  color: #071329;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(15, 32, 64, 0.035);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.lp-ad-option:hover {
  border-color: #b9c8da;
  box-shadow: 0 12px 28px rgba(15, 32, 64, 0.07);
  transform: translateY(-1px);
}
.lp-ad-option strong {
  display: block;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}
.lp-ad-option small {
  display: block;
  margin-top: 7px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.35;
}
.lp-ad-option-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  justify-self: end;
  border-radius: 8px;
  color: #475569;
}
.lp-ad-stage {
  display: grid;
  justify-items: center;
  min-width: 0;
}
.lp-meta-card {
  display: none;
  width: min(100%, 448px);
  overflow: hidden;
  border: 1px solid #dfe6f0;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 54px rgba(15, 32, 64, 0.12);
}
.lp-meta-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px 10px;
}
.lp-meta-page {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}
.lp-meta-avatar {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 8px;
  background: #071329;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.05em;
}
.lp-meta-page strong {
  display: block;
  color: #071329;
  font-size: 14px;
  line-height: 1.2;
}
.lp-meta-sponsored {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
}
.lp-meta-more {
  flex: none;
  color: #475569;
}
.lp-meta-copy {
  margin: 0;
  padding: 0 16px 14px;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.45;
}
.lp-ad-creative {
  position: relative;
  min-height: 284px;
  overflow: hidden;
  background: #e8edf4;
}
.lp-ad-creative img {
  width: 100%;
  height: 100%;
  min-height: 284px;
  display: block;
  object-fit: cover;
}
.lp-ad-creative::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(7, 19, 41, 0.06), rgba(7, 19, 41, 0.38));
}
.lp-creative-badge,
.lp-creative-location,
.lp-creative-panel {
  position: absolute;
  z-index: 1;
}
.lp-creative-badge {
  top: 16px;
  left: 16px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.94);
  color: #071329;
  padding: 8px 11px;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.12em;
}
.lp-creative-location {
  right: 16px;
  bottom: 16px;
  border-radius: 4px;
  background: rgba(7, 19, 41, 0.92);
  color: #ffffff;
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 750;
}
.lp-creative-panel {
  left: 16px;
  right: 86px;
  bottom: 16px;
  display: grid;
  gap: 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: #071329;
  padding: 16px;
  backdrop-filter: blur(8px);
}
.lp-creative-panel span {
  color: #1677ff;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.lp-creative-panel strong {
  color: inherit;
  font-size: 22px;
  line-height: 1.08;
  letter-spacing: -0.01em;
}
.lp-creative-panel small {
  color: #475569;
  font-size: 12px;
  line-height: 1.35;
}
.lp-ad-creative-open-home .lp-creative-panel,
.lp-ad-creative-just-sold .lp-creative-panel {
  background: rgba(7, 19, 41, 0.9);
  color: #ffffff;
}
.lp-ad-creative-open-home .lp-creative-panel small,
.lp-ad-creative-just-sold .lp-creative-panel small {
  color: rgba(255, 255, 255, 0.78);
}
.lp-ad-creative-open-home .lp-creative-panel span,
.lp-ad-creative-just-sold .lp-creative-panel span {
  color: #ffffff;
}
.lp-ad-creative-free-appraisal .lp-creative-panel {
  background: rgba(7, 19, 41, 0.92);
  color: #ffffff;
}
.lp-ad-creative-free-appraisal .lp-creative-panel span { color: #afc6ff; }
.lp-ad-creative-free-appraisal .lp-creative-panel small { color: rgba(255, 255, 255, 0.78); }
.lp-ad-creative-buyer-demand .lp-creative-panel { border-left: 5px solid #20b8b0; }
.lp-ad-creative-market-update .lp-creative-panel { border-top: 5px solid #1677ff; }
.lp-meta-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e5edf6;
}
.lp-meta-link-copy {
  min-width: 0;
}
.lp-meta-domain {
  display: block;
  color: #64748b;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.12em;
}
.lp-meta-link-copy strong {
  display: block;
  margin-top: 4px;
  color: #071329;
  font-size: 15px;
  line-height: 1.18;
}
.lp-meta-link-copy span {
  display: block;
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lp-meta-cta {
  flex: none;
  border-radius: 4px;
  background: #e3e8ef;
  color: #071329;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 750;
  white-space: nowrap;
}
.lp-meta-engagement {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  color: #64748b;
  font-size: 12px;
}
.lp-meta-reactions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lp-meta-reaction-icon {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #1677ff;
  color: #ffffff;
}
.lp-meta-actions {
  display: flex;
  gap: 18px;
  font-weight: 650;
}
#ready-ad-just-listed:checked ~ .lp-ad-options label[for="ready-ad-just-listed"],
#ready-ad-open-home:checked ~ .lp-ad-options label[for="ready-ad-open-home"],
#ready-ad-just-sold:checked ~ .lp-ad-options label[for="ready-ad-just-sold"],
#ready-ad-free-appraisal:checked ~ .lp-ad-options label[for="ready-ad-free-appraisal"],
#ready-ad-buyer-demand:checked ~ .lp-ad-options label[for="ready-ad-buyer-demand"],
#ready-ad-market-update:checked ~ .lp-ad-options label[for="ready-ad-market-update"] {
  border-color: #1677ff;
  box-shadow: 0 0 0 1px #1677ff, 0 16px 34px rgba(22, 119, 255, 0.12);
}
#ready-ad-just-listed:checked ~ .lp-ad-options label[for="ready-ad-just-listed"] .lp-ad-option-icon,
#ready-ad-open-home:checked ~ .lp-ad-options label[for="ready-ad-open-home"] .lp-ad-option-icon,
#ready-ad-just-sold:checked ~ .lp-ad-options label[for="ready-ad-just-sold"] .lp-ad-option-icon,
#ready-ad-free-appraisal:checked ~ .lp-ad-options label[for="ready-ad-free-appraisal"] .lp-ad-option-icon,
#ready-ad-buyer-demand:checked ~ .lp-ad-options label[for="ready-ad-buyer-demand"] .lp-ad-option-icon,
#ready-ad-market-update:checked ~ .lp-ad-options label[for="ready-ad-market-update"] .lp-ad-option-icon {
  background: #1677ff;
  color: #ffffff;
}
#ready-ad-just-listed:focus-visible ~ .lp-ad-options label[for="ready-ad-just-listed"],
#ready-ad-open-home:focus-visible ~ .lp-ad-options label[for="ready-ad-open-home"],
#ready-ad-just-sold:focus-visible ~ .lp-ad-options label[for="ready-ad-just-sold"],
#ready-ad-free-appraisal:focus-visible ~ .lp-ad-options label[for="ready-ad-free-appraisal"],
#ready-ad-buyer-demand:focus-visible ~ .lp-ad-options label[for="ready-ad-buyer-demand"],
#ready-ad-market-update:focus-visible ~ .lp-ad-options label[for="ready-ad-market-update"] {
  outline: 3px solid rgba(22, 119, 255, 0.25);
  outline-offset: 3px;
}
#ready-ad-just-listed:checked ~ .lp-ad-stage [data-ad="just-listed"],
#ready-ad-open-home:checked ~ .lp-ad-stage [data-ad="open-home"],
#ready-ad-just-sold:checked ~ .lp-ad-stage [data-ad="just-sold"],
#ready-ad-free-appraisal:checked ~ .lp-ad-stage [data-ad="free-appraisal"],
#ready-ad-buyer-demand:checked ~ .lp-ad-stage [data-ad="buyer-demand"],
#ready-ad-market-update:checked ~ .lp-ad-stage [data-ad="market-update"] {
  display: block;
}
@media (max-width: 980px) {
  .lp-ad-switcher {
    grid-template-columns: 1fr;
    gap: 34px;
  }
  .lp-ad-options {
    max-width: 620px;
    width: 100%;
    margin: 0 auto;
  }
}
@media (max-width: 620px) {
  .lp-ad-showcase { padding: 58px 0 64px; }
  .lp-ad-option {
    min-height: 76px;
    grid-template-columns: minmax(0, 1fr) 36px;
    padding: 15px 16px;
  }
  .lp-ad-option strong { font-size: 16px; }
  .lp-ad-option small { font-size: 12px; }
  .lp-ad-option-icon {
    width: 34px;
    height: 34px;
  }
  .lp-meta-card { width: 100%; }
  .lp-ad-creative,
  .lp-ad-creative img { min-height: 248px; }
  .lp-creative-panel {
    right: 16px;
    padding: 14px;
  }
  .lp-creative-panel strong { font-size: 19px; }
  .lp-creative-location { display: none; }
  .lp-meta-link {
    align-items: flex-start;
    flex-direction: column;
  }
  .lp-meta-cta { width: 100%; text-align: center; }
  .lp-meta-actions { gap: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .lp-ad-option { transition: none; }
  .lp-ad-option:hover { transform: none; }
}
`;

const TABLE_ROWS = [
  { name: "Mt Lawley appraisal", description: "Listing lead angle", status: "Active", clicks: "247", leads: "18", spend: "$324" },
  { name: "Subiaco just listed", description: "Listing attention", status: "Active", clicks: "182", leads: "11", spend: "$210" },
  { name: "Cottesloe open home", description: "Open home traffic", status: "Paused", clicks: "93", leads: "7", spend: "$98" },
  { name: "South Perth market update", description: "Listing proof", status: "Draft", clicks: "--", leads: "--", spend: "--" },
] as const;

export default function HomePage() {
  return (
    <div className="lp">
      <header className="lp-nav-wrap">
        <div className="lp-shell lp-nav">
          <Link className="lp-brand" href="/" aria-label="Blockwise home">
            <BlockwiseLogo />
          </Link>
          <nav className="lp-nav-links" aria-label="Primary">
            <a href="#radar">Ad Radar</a>
            <a href="#done-for-you">Done for you</a>
            <a href="#property-check">Property Check</a>
            <a href="#workflow">How it works</a>
            <a href="#free-trial">Free trial</a>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <div className="lp-nav-actions">
            <SignInLink />
            <CtaLink location="nav" href="/signup" className="lp-btn lp-btn-primary">
              Start free trial
            </CtaLink>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-shell lp-hero-center">
            <span className="lp-hero-pill">
              <span className="lp-hero-pill-dot" aria-hidden />
              Meta ads for real estate agents
            </span>
            <h1 id="hero-title">See what competitors are running. Get your first ad prepared today.</h1>
            <p className="lp-hero-sub">
              Blockwise prepares real estate ads from what&rsquo;s working in your area, so you can get more
              leads and listings without building ads yourself.
            </p>
            <div className="lp-hero-scan">
              <LandingAdRadarScan
                buttonLabel="Scan my suburb"
                initialNote="Start with Perth, WA or choose your suburb."
                initialValue="Perth, WA"
                placeholder="Enter city, agent, or brokerage"
                useBestGuess
              />
            </div>
            <p className="lp-hero-microcopy">7-day trial · 10 ads · No card required</p>
          </div>
        </section>

        <section id="workflow" className="lp-section lp-flow" aria-label="Blockwise ad workflow">
          <style dangerouslySetInnerHTML={{ __html: FLOW_CSS }} />
          <div className="flow-shell">
            <div className="flow-panel">
              <div className="flow-workflow">
                <div className="flow-col">
                  <h2 className="flow-zone-title">Ad work agents get stuck doing</h2>
                  <div className="flow-task-stack" aria-label="Manual ad tasks">
                    <article className="flow-task-card">
                      <strong>Pick suburb audience</strong>
                      <span>Meta targeting choices</span>
                      <span className="flow-warn">Needs review</span>
                    </article>
                    <article className="flow-task-card">
                      <strong>Write listing lead copy</strong>
                      <span>Hooks, headline, CTA</span>
                      <span className="flow-warn">Draft again</span>
                    </article>
                    <article className="flow-task-card">
                      <strong>Resize listing image</strong>
                      <span>Feed, story, reels</span>
                      <span className="flow-warn">Wrong size</span>
                    </article>
                    <article className="flow-task-card">
                      <strong>Set lead form questions</strong>
                      <span>Contact, suburb, intent</span>
                      <span className="flow-warn">Not ready</span>
                    </article>
                    <article className="flow-task-card">
                      <strong>Send vendor update</strong>
                      <span>Spend, leads, result</span>
                      <span className="flow-warn">Still pending</span>
                    </article>
                    <span className="flow-arrow" aria-hidden="true" />
                  </div>
                </div>

                <div className="flow-col">
                  <h2 className="flow-zone-title">Blockwise prepares it</h2>
                  <article className="flow-card flow-review">
                    <div className="flow-review-head">
                      <span className="flow-pill green">Ready for review</span>
                      <span className="flow-pill teal">Listing leads</span>
                    </div>
                    <div className="flow-preview-box" aria-hidden="true" />
                    <div className="flow-fields">
                      <div className="flow-field"><span className="flow-small">Angle</span><strong>Free appraisal</strong></div>
                      <div className="flow-field"><span className="flow-small">Creative</span><strong>Prepared</strong></div>
                      <div className="flow-field"><span className="flow-small">Lead form</span><strong>Ready</strong></div>
                      <div className="flow-field"><span className="flow-small">Budget</span><strong>$25/day</strong></div>
                      <div className="flow-field"><span className="flow-small">Updates</span><strong>Daily email</strong></div>
                    </div>
                    <button type="button" className="flow-primary-btn flow-approve">Approve</button>
                  </article>
                </div>

                <div className="flow-col">
                  <h2 className="flow-zone-title">Then updates are sent</h2>
                  <article className="flow-card flow-daily">
                    <div className="flow-daily-head">
                      <h3>Daily update</h3>
                      <span className="flow-pill green">Example</span>
                    </div>
                    <div className="flow-metric-grid">
                      <div className="flow-metric"><span className="flow-small">Leads</span><b>12</b></div>
                      <div className="flow-metric"><span className="flow-small">Spend</span><b>$86</b></div>
                    </div>
                    <div className="flow-summary">
                      <div className="flow-row"><span className="flow-small">Best angle</span><strong>Free appraisal</strong></div>
                      <p className="flow-small">Summary ready without logging into Ads Manager.</p>
                    </div>
                    <div className="flow-email-preview" aria-label="Daily update email preview">
                      <strong>Daily email sent</strong>
                      <span className="flow-small">Leads, spend and best angle summarized.</span>
                      <div className="flow-email-line" />
                      <div className="flow-email-line" />
                      <div className="flow-email-line" />
                    </div>
                    <p className="flow-update-note">
                      The agent gets the summary without checking dashboards or sending manual updates.
                    </p>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="done-for-you" className="lp-section lp-ad-showcase" aria-labelledby="dfy-title">
          <style dangerouslySetInnerHTML={{ __html: READY_MADE_ADS_CSS }} />
          <div className="lp-shell">
            <h2 className="sr-only" id="dfy-title">Pick the ad you need.</h2>
            <div className="lp-ad-switcher">
              {READY_MADE_ADS.map((ad) => (
                <input
                  className="lp-ad-radio"
                  defaultChecked={ad.id === "free-appraisal"}
                  id={`ready-ad-${ad.id}`}
                  key={`input-${ad.id}`}
                  name="ready-made-ad"
                  type="radio"
                />
              ))}

              <div className="lp-ad-options" aria-label="Ready-made ad examples">
                {READY_MADE_ADS.map((ad) => (
                  <label className="lp-ad-option" htmlFor={`ready-ad-${ad.id}`} key={ad.id}>
                    <span>
                      <strong>{ad.title}</strong>
                      <small>{ad.description}</small>
                    </span>
                    <span className="lp-ad-option-icon" aria-hidden>
                      <ArrowRight size={20} strokeWidth={2.4} />
                    </span>
                  </label>
                ))}
              </div>

              <div className="lp-ad-stage" aria-live="polite">
                {READY_MADE_ADS.map((ad) => (
                  <article className="lp-meta-card" data-ad={ad.id} key={`preview-${ad.id}`}>
                    <div className="lp-meta-head">
                      <div className="lp-meta-page">
                        <span className="lp-meta-avatar" aria-hidden>BW</span>
                        <div>
                          <strong>Blockwise Realty</strong>
                          <span className="lp-meta-sponsored">
                            Sponsored
                            <Globe2 size={12} strokeWidth={2.2} aria-hidden />
                          </span>
                        </div>
                      </div>
                      <MoreHorizontal className="lp-meta-more" size={20} strokeWidth={2.4} aria-hidden />
                    </div>
                    <p className="lp-meta-copy">{ad.postText}</p>

                    <div className={`lp-ad-creative lp-ad-creative-${ad.id}`}>
                      <img src={ad.image} alt="" loading={ad.id === "free-appraisal" ? "eager" : "lazy"} />
                      <span className="lp-creative-badge">{ad.badge}</span>
                      <div className="lp-creative-panel">
                        <span>{ad.title}</span>
                        <strong>{ad.creativeHeadline}</strong>
                        <small>{ad.creativeSubline}</small>
                      </div>
                      <span className="lp-creative-location">{ad.location}</span>
                    </div>

                    <div className="lp-meta-link">
                      <div className="lp-meta-link-copy">
                        <span className="lp-meta-domain">{ad.domain}</span>
                        <strong>{ad.linkHeadline}</strong>
                        <span>{ad.linkDescription}</span>
                      </div>
                      <span className="lp-meta-cta">{ad.cta}</span>
                    </div>

                    <div className="lp-meta-engagement" aria-label={`${ad.reactions} reactions`}>
                      <span className="lp-meta-reactions">
                        <span className="lp-meta-reaction-icon" aria-hidden>
                          <ThumbsUp size={11} strokeWidth={3} />
                        </span>
                        {ad.reactions}
                      </span>
                      <span className="lp-meta-actions" aria-hidden>
                        <span>Like</span>
                        <span>Comment</span>
                        <span>Share</span>
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="property-check" className="lp-section lp-section-surface">
          <div className="lp-shell">
            <div className="lp-center-head">
              <p className="lp-eyebrow">Property Check</p>
              <h2 className="lp-h2">Know the property before the call</h2>
              <p className="lp-lead">
                Check zoning, overlays, subdivision potential, renovation limits, and planning red flags before
                speaking to a prospect, buyer, or investor.
              </p>
            </div>
            <div className="lp-features">
              <Feature
                title="Listing appraisal prep"
                copy="Walk in with useful property signals, not guesses."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-8h6v8" /></svg>}
              />
              <Feature
                title="Buyer questions"
                copy="Answer common build, extend, renovate, and subdivision questions with source-cited notes."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4" /><path d="M12 17h.01" /></svg>}
              />
              <Feature
                title="Lead follow-up"
                copy="Turn ad leads into better client conversations."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h6" /><path d="m16 3 5 5" /><path d="m21 3-5 5" /></svg>}
              />
            </div>
            <div className="lp-section-cta">
              <CtaLink location="property-check" href="/signup?source=property-check" className="lp-btn lp-btn-primary lp-btn-big">
                Run a property check
              </CtaLink>
            </div>
          </div>
        </section>

        <section id="approval" className="lp-section lp-section-surface lp-control-section" aria-labelledby="control-title">
          <div className="lp-shell lp-control-grid">
            <div className="lp-control-copy">
              <p className="lp-eyebrow">Approval and control</p>
              <h2 className="lp-h2" id="control-title">You stay in control before and after approval.</h2>
              <p className="lp-lead">
                Review what goes live before anything spends, then track spend, leads and status from one clean dashboard.
              </p>
              <ul className="lp-control-list" aria-label="Control points">
                <li><span className="lp-check" aria-hidden>✓</span>Approve every ad before it goes live</li>
                <li><span className="lp-check" aria-hidden>✓</span>Use your own Meta ad account</li>
                <li><span className="lp-check" aria-hidden>✓</span>Control the budget and schedule</li>
                <li><span className="lp-check" aria-hidden>✓</span>See every result in one dashboard</li>
              </ul>
            </div>
            <div className="lp-control-dashboard" aria-label="Ad reporting table preview">
              <div className="lp-control-dashboard-head">
                <div>
                  <span className="lp-table-label">Control dashboard</span>
                  <strong>Every ad in one place</strong>
                </div>
                <div className="lp-table-actions">
                  <span className="lp-table-pill">Example data</span>
                  <CtaLink location="control-table" href="/signup" className="lp-control-create">
                    Create ad
                  </CtaLink>
                </div>
              </div>
              <div className="lp-table-scroll">
                <table className="lp-table">
                  <thead>
                    <tr><th>Ad</th><th>Status</th><th>Clicks</th><th>Leads</th><th>Spend</th></tr>
                  </thead>
                  <tbody>
                    {TABLE_ROWS.map((row) => (
                      <tr key={row.name}>
                        <td><strong>{row.name}</strong><span>{row.description}</span></td>
                        <td>
                          <span className={`lp-table-status lp-table-status-${row.status.toLowerCase()}`}>
                            {row.status}
                          </span>
                        </td>
                        <td>{row.clicks}</td>
                        <td>{row.leads}</td>
                        <td>{row.spend}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section id="reporting" className="lp-section lp-reporting-section">
          <div className="lp-shell">
            <div className="lp-center-head lp-reporting-head">
              <h2 className="lp-h2">Updates where agents actually check.</h2>
              <p className="lp-lead">Open Blockwise for the detail. Get the short version by email.</p>
            </div>

            <div className="lp-reporting-grid" aria-label="Blockwise reporting preview">
              <article className="lp-reporting-card">
                <div className="lp-reporting-card-head">
                  <h3>Daily email</h3>
                  <span className="lp-reporting-badge lp-reporting-badge-blue">Optional</span>
                </div>
                <div className="lp-reporting-card-body">
                  <h4>Your ads yesterday</h4>
                  <div className="lp-reporting-metrics" aria-label="Email summary metrics">
                    <div><strong>6</strong><span>New leads</span></div>
                    <div><strong>$41</strong><span>Spend</span></div>
                    <div><strong>118</strong><span>Clicks</span></div>
                  </div>
                  <ul className="lp-reporting-email-list">
                    <li>Free appraisal ad is live.</li>
                    <li>Market update ad needs approval.</li>
                    <li>No Ads Manager login needed.</li>
                  </ul>
                </div>
              </article>

              <article className="lp-reporting-card">
                <div className="lp-reporting-card-head">
                  <h3>Blockwise dashboard</h3>
                  <span className="lp-reporting-badge lp-reporting-badge-green">Live</span>
                </div>
                <div className="lp-reporting-card-body lp-reporting-status-list">
                  <div className="lp-reporting-row">
                    <span className="lp-reporting-icon" aria-hidden>✓</span>
                    <div><h4>Status</h4><p>See what is live, paused or waiting.</p></div>
                    <span className="lp-reporting-badge lp-reporting-badge-green">Live</span>
                  </div>
                  <div className="lp-reporting-row">
                    <span className="lp-reporting-icon" aria-hidden>$</span>
                    <div><h4>Spend</h4><p>Know what has been spent.</p></div>
                    <span className="lp-reporting-badge lp-reporting-badge-blue">$186</span>
                  </div>
                  <div className="lp-reporting-row">
                    <span className="lp-reporting-icon" aria-hidden>↗</span>
                    <div><h4>Results</h4><p>Track clicks and leads in one place.</p></div>
                    <span className="lp-reporting-badge lp-reporting-badge-blue">17 leads</span>
                  </div>
                  <div className="lp-reporting-row">
                    <span className="lp-reporting-icon" aria-hidden>!</span>
                    <div><h4>Next step</h4><p>Know when something needs approval.</p></div>
                    <span className="lp-reporting-badge lp-reporting-badge-amber">Review</span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="free-trial" className="lp-section lp-trial">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow lp-eyebrow-green">Free trial</p>
              <h2 className="lp-h2 lp-h2-light">Try Blockwise with 10 free ads.</h2>
              <p className="lp-lead lp-lead-light">
                No card required. Create draft ads, review them and connect your ad account
                when you are ready for final setup.
              </p>
              <CtaLink location="trial" href="/signup" className="lp-btn lp-btn-light lp-btn-big">
                Start free trial
              </CtaLink>
            </div>
            <div className="lp-trial-grid">
              <div className="lp-trial-item"><strong>7 days</strong><span>Full access to the ad builder from the minute you confirm your email.</span></div>
              <div className="lp-trial-item"><strong>10 free ads</strong><span>Create up to 10 free ads during the trial.</span></div>
              <div className="lp-trial-item"><strong>No card</strong><span>Nothing charges when the trial ends. Your drafts stay put.</span></div>
              <div className="lp-trial-item"><strong>Connect anytime</strong><span>Connect your Meta ad account when you are ready.</span></div>
            </div>
          </div>
        </section>

        <section id="managed-setup" className="lp-section lp-section-surface" aria-labelledby="demo-title">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow">Managed setup</p>
              <h2 className="lp-h2" id="demo-title">Want help preparing your first ad?</h2>
              <p className="lp-lead">
                Book a 15-minute walkthrough. We&rsquo;ll help you create your first ad, connect
                your ad account and review everything before handoff.
              </p>
            </div>
            <DemoForm />
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-shell lp-faq-grid">
            <div>
              <p className="lp-eyebrow">Questions</p>
              <h2 className="lp-h2">The bits agents ask about.</h2>
              <div className="lp-faq-list">
                <details open>
                  <summary>Who pays for ad spend?</summary>
                  <p>
                    You do. Ads run through your connected ad account and your ad spend is paid to
                    the platform directly. Blockwise is the software used to create, approve, export and
                    track the ad.
                  </p>
                </details>
                <details>
                  <summary>Do I need a Meta ad account?</summary>
                  <p>
                    You can create and review ads before connecting Meta. To move from draft to a
                    live ad, connect your Meta ad account for final setup.
                  </p>
                </details>
                <details>
                  <summary>Can I approve ads before they run?</summary>
                  <p>
                    Yes. Nothing is sent for launch until your team approves the copy, creative, lead form,
                    budget and schedule.
                  </p>
                </details>
                <details>
                  <summary>Can I see results inside Blockwise?</summary>
                  <p>
                    Yes. Once your ad account is connected, Blockwise shows status, spend, clicks, leads and
                    performance metrics inside the app.
                  </p>
                </details>
                <details>
                  <summary>Are the ads checked before export?</summary>
                  <p>
                    Blockwise flags common property advertising risks and brand issues before approval.
                    Your agency remains responsible for final review, claims, pricing language and
                    export.
                  </p>
                </details>
                <details>
                  <summary>What happens after the 7 days?</summary>
                  <p>
                    Creating ads pauses and we ask you to pick a plan. We never took a card, so
                    there is no surprise charge. Your drafts stay put.
                  </p>
                </details>
              </div>
            </div>
            <aside className="lp-setup-card">
              <h3>Need a hand getting started?</h3>
              <p>
                Book a 15-minute walkthrough. We&rsquo;ll help you create your first ad, connect
                your ad account and get everything ready for final setup.
              </p>
              <CtaLink location="faq-walkthrough" href="#managed-setup" className="lp-btn lp-btn-hero">
                Book a walkthrough
              </CtaLink>
            </aside>
          </div>
        </section>

        <section id="radar" className="lp-section lp-section-surface">
          <div className="lp-shell">
            <div className="lp-radar-top">
              <div>
                <p className="lp-eyebrow">Local Ad Radar</p>
                <h2 className="lp-h2">What are your competitors running?</h2>
                <p className="lp-lead">
                  Search any market and see active real estate ads.
                </p>
              </div>
              <div className="lp-radar-box">
                <LandingAdRadarScan
                  buttonLabel="Scan my market"
                  initialNote="Start with Perth, WA or choose your suburb."
                  initialValue="Perth, WA"
                  placeholder="Enter city, agent, or brokerage"
                  useBestGuess
                />
              </div>
            </div>
            <LandingRadarCards />
          </div>
        </section>
      </main>

      <footer className="lp-footer" aria-label="Footer">
        <div className="lp-shell lp-footer-grid">
          <div>
            <BlockwiseLogo />
            <p>
              The ad platform for real estate teams. Create, approve, export and track property
              ads from one place.
            </p>
            <p className="lp-footer-contact">
              <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#radar">Ad Radar</a>
            <a href="#done-for-you">Done for you</a>
            <a href="#property-check">Property Check</a>
            <a href="#workflow">How it works</a>
            <a href="#free-trial">Free trial</a>
            <Link href="/pricing">Pricing</Link>
          </div>
          <div>
            <h4>Legal</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </div>
        </div>
        <div className="lp-shell lp-footer-bottom">
          <span>© {new Date().getFullYear()} Blockwise. All rights reserved.</span>
          {/* Social icons are decorative until the profiles exist — swap spans for links then. */}
          <span className="lp-footer-social" aria-hidden style={{ pointerEvents: "none" }}>
            <span className="lp-social-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </span>
            <span className="lp-social-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12M7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0" /></svg>
            </span>
            <span className="lp-social-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069m0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0m0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881" /></svg>
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
