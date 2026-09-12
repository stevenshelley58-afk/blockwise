import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import geometry from "../src/components/motion-study/workflow-motion-study-geometry.ts";

const { STUDY_AD_SCALE, studyAdMotion } = geometry;

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
  assert.match(styles, /\.bwStudyEditPanel input/);
  assert.match(styles, /font-size: 14px/);
});

test("geometry stays inside desktop and mobile bounds without panel overlap", () => {
  const cases = [
    { width: 320, height: 700, adWidth: 204, adHeight: 400, narrow: true, panelTop: 390 },
    { width: 390, height: 760, adWidth: 224, adHeight: 440, narrow: true, panelTop: 420 },
    { width: 700, height: 560, adWidth: 300, adHeight: 550, narrow: false },
    { width: 768, height: 560, adWidth: 300, adHeight: 550, narrow: false },
    { width: 900, height: 560, adWidth: 300, adHeight: 550, narrow: false },
    { width: 1040, height: 560, adWidth: 300, adHeight: 550, narrow: false },
  ];

  for (const item of cases) {
    const start = studyAdMotion({ stageWidth: item.width, stageHeight: item.height, adWidth: item.adWidth, adHeight: item.adHeight, narrow: item.narrow, customise: false });
    const end = studyAdMotion({ stageWidth: item.width, stageHeight: item.height, adWidth: item.adWidth, adHeight: item.adHeight, narrow: item.narrow, customise: true });
    assert.equal(start.scale, 1);
    assert.equal(end.scale, STUDY_AD_SCALE);
    assert.notDeepEqual(end, start);
    assert.ok(start.x >= 0 && start.y >= 0);
    assert.ok(start.x + item.adWidth <= item.width);
    assert.ok(start.y + item.adHeight <= item.height);
    assert.ok(end.x >= 0 && end.y >= 0);
    assert.ok(end.x + item.adWidth * end.scale <= item.width + 0.01);
    assert.ok(end.y + item.adHeight * end.scale <= item.height + 0.01);
    if (item.narrow) {
      assert.ok(end.y + item.adHeight * end.scale <= item.panelTop);
    } else {
      const panelWidth = Math.min(item.width * 0.36, 330);
      const panelLeft = item.width - 72 - panelWidth;
      assert.ok(end.x + item.adWidth * end.scale + 28 <= panelLeft + 0.01);
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
