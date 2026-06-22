import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { DemoForm } from "@/components/landing/demo-form";
import { LandingEvidenceSlabAds } from "@/components/landing/landing-evidence-slab-ads";
import { SignInLink } from "@/components/landing/sign-in-link";
import { LandingAdRadarScan } from "@/components/research/landing-ad-radar-scan";

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
  transition: background 0.15s ease, transform 0.15s ease;
}
.lp-flow .flow-btn:hover { background: #0f63e6; }
.lp-flow .flow-btn:active { transform: translateY(1px); }
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

const TABLE_ROWS = [
  { name: "Mt Lawley Appraisal", status: "Active", clicks: "247", leads: "18", spend: "$324" },
  { name: "Subiaco Just Listed", status: "Active", clicks: "182", leads: "11", spend: "$210" },
  { name: "Cottesloe Open Home", status: "Paused", clicks: "93", leads: "7", spend: "$98" },
  { name: "South Perth Auction", status: "Active", clicks: "145", leads: "9", spend: "$176" },
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
            <a href="#workflow">How it works</a>
            <a href="#property-check">Property Check</a>
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
            <h1 id="hero-title">Your competitors are advertising. Are you?</h1>
            <p className="lp-hero-sub">
              Ads built from what&rsquo;s actually working in your area. Start getting leads today.
            </p>
            <div className="lp-hero-scan">
              <LandingAdRadarScan
                buttonLabel="Free suburb audit"
                initialNote="Start with Perth, WA or choose your suburb."
                initialValue="Perth, WA"
                placeholder="Enter city, agent, or brokerage"
                useBestGuess
              />
            </div>
            <p className="lp-hero-microcopy">7-day free trial · No credit card required</p>
          </div>
        </section>

        {/* Evidence slab: real Meta Ad Library creative as a layered 3D object,
            with a readout explaining one ad at a time. Reads the existing
            local-ad-radar API. The hero suburb audit handles search. */}
        <LandingEvidenceSlabAds initialLocation="Perth, WA" limit={7} />

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
                      <strong>Write seller lead copy</strong>
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
                      <span className="flow-pill teal">Seller leads</span>
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

        <section id="campaign-types" className="lp-section">
          <div className="lp-shell">
            <div className="lp-center-head">
              <p className="lp-eyebrow">Done for you</p>
              <h2 className="lp-h2">We build your real estate ads for you.</h2>
              <p className="lp-lead">
                Blockwise writes the ads, builds the lead form and sets everything up. You just
                approve what goes live, then export the package for final setup in your own ad account.
              </p>
            </div>
            <div className="lp-features">
              <Feature
                title="Facebook and Instagram ads"
                copy="Headlines, primary text, descriptions and creative variants — written for you, ready to run."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z" /></svg>}
              />
              <Feature
                title="Lead forms"
                copy="Questions, privacy details and thank-you screen, built and matched to your goal."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>}
              />
              <Feature
                title="Proven local angles"
                copy="Just Listed, Open Home, Just Sold, Free Appraisal, Buyer Demand and Market Update."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>}
              />
              <Feature
                title="Budget and schedule"
                copy="We set the spend and timing. Ad spend runs through your own ad account."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>}
              />
              <Feature
                title="Approval checks"
                copy="We flag common review issues around claims, pricing language and brand fit before sign off."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>}
              />
              <Feature
                title="Live reporting"
                copy="Track impressions, clicks, leads, spend and status inside Blockwise."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="5" width="3" height="12" /></svg>}
              />
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
                speaking to a seller, buyer, or investor.
              </p>
            </div>
            <div className="lp-features">
              <Feature
                title="Seller appraisal prep"
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

        <section id="approval" className="lp-section lp-section-surface" aria-labelledby="control-title">
          <div className="lp-shell lp-split lp-split-swap">
            <div>
              <p className="lp-eyebrow">Approval and control</p>
              <h2 className="lp-h2" id="control-title">You stay in control before anything leaves draft.</h2>
              <p className="lp-lead">
                Every ad is drafted inside Blockwise, reviewed by your team and exported for
                final platform setup only after approval.
              </p>
              <ul className="lp-control-list" aria-label="Control points">
                <li><span className="lp-check" aria-hidden>✓</span>Approve every ad before export</li>
                <li><span className="lp-check" aria-hidden>✓</span>Use your own Meta ad account</li>
                <li><span className="lp-check" aria-hidden>✓</span>Control the budget and schedule</li>
                <li><span className="lp-check" aria-hidden>✓</span>See every result in one dashboard</li>
              </ul>
            </div>
            <div className="lp-table-card" aria-label="Ad performance table preview">
              <div className="lp-table-bar">
                <div>
                  <strong>Your ads</strong>
                  <span className="lp-badge lp-badge-neutral">Example data</span>
                </div>
                <CtaLink location="control-table" href="/signup" className="lp-btn lp-btn-primary lp-btn-sm">
                  Get started
                </CtaLink>
              </div>
              <div className="lp-table-scroll">
                <table className="lp-table">
                  <thead>
                    <tr><th>Ad</th><th>Status</th><th>Clicks</th><th>Leads</th><th>Spend</th></tr>
                  </thead>
                  <tbody>
                    {TABLE_ROWS.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>
                          <span className={row.status === "Active" ? "lp-badge lp-badge-active" : "lp-badge lp-badge-neutral"}>
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

        <section id="reporting" className="lp-section">
          <div className="lp-shell lp-center-head">
            <p className="lp-eyebrow">Reporting</p>
            <h2 className="lp-h2">See status, spend, clicks, and leads in Blockwise.</h2>
            <p className="lp-lead">
              The dashboard brings performance back into the same workspace your team uses
              to review and approve.
            </p>
          </div>
        </section>

        <section id="free-trial" className="lp-section lp-trial">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow lp-eyebrow-green">Free trial</p>
              <h2 className="lp-h2 lp-h2-light">Try Blockwise free for 7 days.</h2>
              <p className="lp-lead lp-lead-light">
                No card required. Review your ads and connect your ad account
                when you are ready for final setup.
              </p>
              <CtaLink location="trial" href="/signup" className="lp-btn lp-btn-light lp-btn-big">
                Start free trial
              </CtaLink>
            </div>
            <div className="lp-trial-grid">
              <div className="lp-trial-item"><strong>7 days</strong><span>Full access from the minute you confirm your email.</span></div>
              <div className="lp-trial-item"><strong>No card</strong><span>Nothing charges when the trial ends. Your drafts stay put.</span></div>
              <div className="lp-trial-item"><strong>Connect anytime</strong><span>Connect your Meta ad account when you are ready.</span></div>
            </div>
          </div>
        </section>

        <section id="managed-setup" className="lp-section lp-section-surface" aria-labelledby="demo-title">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow">Managed setup</p>
              <h2 className="lp-h2" id="demo-title">Want help getting started?</h2>
              <p className="lp-lead">
                Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect
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
                    You do. Your ads run through your connected ad account and your ad spend is paid to
                    the platform directly. Blockwise is the software used to build, approve, export and
                    track your ads.
                  </p>
                </details>
                <details>
                  <summary>Do I need a Meta ad account?</summary>
                  <p>
                    You can review your ads before connecting Meta. To move from draft to live,
                    connect your Meta ad account for final setup.
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
                    Yes. Once your ads are connected, Blockwise shows status, spend, clicks, leads and
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
                    Your free access pauses and we ask you to pick a plan. We never took a card, so
                    there is no surprise charge. Your drafts stay put.
                  </p>
                </details>
              </div>
            </div>
            <aside className="lp-setup-card">
              <h3>Need a hand getting started?</h3>
              <p>
                Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect
                your ad account and get everything ready for final setup.
              </p>
              <CtaLink location="faq-walkthrough" href="#managed-setup" className="lp-btn lp-btn-hero">
                Book a walkthrough
              </CtaLink>
            </aside>
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
            <a href="#workflow">How it works</a>
            <a href="#property-check">Property Check</a>
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
