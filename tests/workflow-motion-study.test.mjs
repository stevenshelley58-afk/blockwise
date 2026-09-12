import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import geometry from "../src/components/motion-study/workflow-motion-study-geometry.ts";

const { STUDY_AD_SCALE, STUDY_PANEL_GAP, studyAdMotion, studyEditLayout } = geometry;

const source = await readFile(new URL("../src/components/motion-study/workflow-motion-study.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/motion-study/workflow-motion-study.module.css", import.meta.url), "utf8");
const motion = await readFile(new URL("../src/lib/motion.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/motion-study/page.tsx", import.meta.url), "utf8");

test("study keeps one selected ad and only Choose/Customise selectors", () => {
  assert.match(source, /const STUDY_STEPS = \[/);
  assert.match(source, /label: "Choose"/);
  assert.match(source, /label: "Customise"/);
  assert.doesNotMatch(source, /label: "Review"/);
  assert.equal((source.match(/<StudyAd /g) ?? []).length, 1);
  assert.match(source, /const SIDE_ADS = \[AD_LIBRARY\[0\], AD_LIBRARY\[2\]\]/);
  assert.ok(source.includes("<Button") && source.includes("arrow={null}"));
  assert.match(source, /aria-pressed=\{step === item\.label\}/);
  assert.ok(source.includes('className={"tw " + styles.bwStudy}'));
  assert.match(route, /blockwise-preview-revision/);
});

test("same ad moves and scales within the stage before fields arrive", () => {
  assert.match(source, /adMoveMs/);
  assert.match(source, /panelRevealMs/);
  assert.match(source, /typeStartMs/);
  assert.match(source, /headlineIndexRef/);
  assert.match(source, /SELECTED_AD\.adTitle\.slice\(0, headlineChars\)/);
  assert.match(source, /className=\{styles\.bwStudyEditSlot\}/);
  assert.match(source, /readOnly/);
  assert.match(styles, /transform-origin: top left/);
  assert.match(styles, /\.bwStudySideAd:last-child \{ grid-column: 3/);
  assert.match(styles, /\.bwStudyEditSlot/);
  assert.ok(styles.includes("transform: translateY(-50%)"));
  assert.match(styles, /\.bwStudyEditPanel textarea/);
  assert.match(styles, /font-size: 14px/);
});

test("geometry centres the desktop group and stays inside actual stage widths", () => {
  const cases = [
    { width: 278, height: 830, adWidth: 204, adHeight: 400, narrow: true },
    { width: 348, height: 820, adWidth: 224, adHeight: 440, narrow: true },
    { width: 668, height: 820, adWidth: 300, adHeight: 550, narrow: true },
    { width: 768, height: 560, adWidth: 300, adHeight: 550, narrow: false },
    { width: 1040, height: 560, adWidth: 300, adHeight: 550, narrow: false },
  ];

  for (const item of cases) {
    const start = studyAdMotion({ ...item, stageWidth: item.width, stageHeight: item.height, customise: false });
    const end = studyAdMotion({ ...item, stageWidth: item.width, stageHeight: item.height, customise: true });
    assert.equal(start.scale, 1);
    assert.equal(end.scale, STUDY_AD_SCALE);
    assert.ok(end.x >= 0 && end.y >= 0);
    assert.ok(end.x + item.adWidth * end.scale <= item.width + 0.01);
    assert.ok(end.y + item.adHeight * end.scale <= item.height + 0.01);
    const layout = studyEditLayout({ stageWidth: item.width, adWidth: item.adWidth, adHeight: item.adHeight, narrow: item.narrow });
    if (item.narrow) {
      assert.ok(end.y + item.adHeight * end.scale <= layout.panelTop);
      assert.equal(layout.panelWidth, item.width - 28);
    } else {
      assert.ok(layout.gap >= 48);
      assert.equal(layout.gap, STUDY_PANEL_GAP);
      assert.ok(end.x + item.adWidth * end.scale + layout.gap <= layout.panelLeft + 0.01);
      assert.ok(Math.abs((end.x + layout.panelLeft + layout.panelWidth) / 2 - item.width / 2) < 0.01);
    }
  }
});

test("study is finite, activity-aware and reduced-motion safe", () => {
  assert.match(source, /autoHoldMs/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /document\.visibilityState/);
  assert.match(source, /useHydratedReducedMotion/);
  assert.match(source, /if \(reduced\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(motion, /workflowStudy:/);
  assert.doesNotMatch(source, /customise: customise && !reduced/);
});

test("preview allows the study without exposing product routes", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /BLOCKWISE_HOMEPAGE_PREVIEW/);
  assert.ok(proxy.includes('pathname === "/motion-study"'));
  assert.ok(proxy.includes('new NextResponse("Not found", { status: 404 })'));
});

test("shown values use multiline fields and match the preview", () => {
  assert.equal((source.match(/<textarea/g) ?? []).length, 3);
  assert.match(source, /id="study-headline"[\s\S]*rows=\{2\}/);
  assert.match(source, /id="study-ad-text"[\s\S]*rows=\{3\}/);
  assert.match(source, /id="study-link-title"[\s\S]*rows=\{2\}/);
  assert.match(source, /Thinking of selling\? Find out what your home could be worth\./);
  assert.match(styles, /overflow: hidden/);
  assert.match(styles, /line-height: 1\.45/);
});

test("autoplay waits for and reacts to measured geometry", () => {
  assert.ok(source.includes("[geometryReady, motionReady, inView, manual, pageVisible, reduced, step]"));
});
