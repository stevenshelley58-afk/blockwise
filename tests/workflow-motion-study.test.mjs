import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/motion-study/workflow-motion-study.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/motion-study/workflow-motion-study.css", import.meta.url), "utf8");
const motion = await readFile(new URL("../src/lib/motion.ts", import.meta.url), "utf8");

test("study keeps one selected ad and only Choose/Customise selectors", () => {
  assert.match(source, /const STUDY_STEPS = \[/);
  assert.match(source, /label: "Choose"/);
  assert.match(source, /label: "Customise"/);
  assert.doesNotMatch(source, /label: "Review"/);
  assert.equal((source.match(/<StudyAd /g) ?? []).length, 1);
  assert.match(source, /const SIDE_ADS = \[AD_LIBRARY\[0\], AD_LIBRARY\[2\]\]/);
  assert.match(source, /<Button[\s\S]*?arrow=\{null\}/);
  assert.match(source, /aria-pressed=\{step === item\.label\}/);
});

test("study moves and scales the same ad before revealing fields", () => {
  assert.match(source, /adMoveMs/);
  assert.match(source, /x: -250, y: 12, scale: 0\.78/);
  assert.match(source, /panelRevealMs/);
  assert.match(source, /typeStartMs/);
  assert.match(source, /setHeadlineChars\(index\)/);
  assert.match(source, /SELECTED_AD\.adTitle\.slice\(0, headlineChars\)/);
  assert.match(styles, /\.bw-study-ad-motion \{[^}]*position: absolute/);
  assert.match(styles, /\.bw-study-edit-panel \{[^}]*position: absolute/);
});

test("study is finite, activity-aware and reduced-motion safe", () => {
  assert.match(source, /autoHoldMs/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /document\.visibilityState/);
  assert.match(source, /useHydratedReducedMotion/);
  assert.match(source, /if \(reduced\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(motion, /workflowStudy:/);
});
