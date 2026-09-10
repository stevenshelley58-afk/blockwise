import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");

/** Source with comments stripped, so prose about the design cannot satisfy or
 *  break a structural assertion. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("workflow runs one ordered pass over six cues and three steps", () => {
  const cueCount = Number(source.match(/const CUE_COUNT = (\d+)/)[1]);
  assert.equal(cueCount, 6);

  const durations = source.match(/const CUE_DURATIONS = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.equal(durations.length, cueCount - 1, "one duration per cue transition, none for the final cue");
  assert.ok(durations.every((d) => d > 0));

  const cueToStep = source.match(/const CUE_TO_STEP = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.equal(cueToStep.length, cueCount);
  assert.deepEqual([...new Set(cueToStep)], [0, 1, 2], "every step is reachable");
  cueToStep.forEach((step, i) => {
    if (i > 0) assert.ok(step >= cueToStep[i - 1], "steps never go backwards during the pass");
  });

  const stepStart = source.match(/const STEP_START_CUE = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.equal(stepStart[0], 0, 'clicking "Choose" must reach the first, unselected state');
  assert.equal(stepStart.length, 3);

  const stepEnd = source.match(/const STEP_END_CUE = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.equal(stepEnd[stepEnd.length - 1], cueCount - 1);
});

test("workflow stops after one pass and offers a transport control", () => {
  assert.match(source, /setCue\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(code, /\? 0 : current \+ 1/, "the story must not loop back to the start on its own");
  assert.match(source, /if \(cue >= LAST_CUE\) \{\s*setPlaying\(false\)/);
  assert.match(source, /function toggleTransport/);
  assert.match(source, /finished \? "Replay" : playing \? "Pause" : "Play"/);
  assert.match(styles, /\.hc-studio-transport button/);
});

test("workflow has no scene mounting, no shared layout ids and no sliding track", () => {
  assert.doesNotMatch(code, /AnimatePresence/, "panels stay mounted so there is no key contract to break");
  assert.doesNotMatch(code, /layoutId/, "no shared element morphs across mount boundaries");
  assert.doesNotMatch(code, /x: `-\$\{/, "no percentage translate carousel");
  assert.doesNotMatch(styles, /hc-story-template-track|width: max-content/, "no overflowing track");
  assert.match(styles, /\.hc-studio-template-grid/);
  assert.match(source, /TEMPLATE_CARDS/);
  const cards = source.match(/const TEMPLATE_CARDS = \[([\s\S]*?)\] as const/)[1];
  const inlineCards = (cards.match(/\{ id:/g) || []).length;
  const storyCards = (cards.match(/^\s*STORY_TEMPLATE,/gm) || []).length;
  assert.equal(inlineCards + storyCards, 4, "exactly four template cards");
  assert.equal(storyCards, 1, "one of them is the story template");
  assert.match(source, /const SELECTED_CARD_INDEX = 1/);
});

test("workflow respects reduced motion, viewport and page visibility", () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /if \(!playing \|\| !inView \|\| !pageVisible \|\| reduceMotion\) return/);
  assert.match(source, /setCue\(LAST_CUE\)/);
  assert.match(source, /reduceMotion \? null : \(/, "the transport is hidden when there is nothing to pause");
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("workflow announces three steps, not every cue", () => {
  const statuses = [...source.match(/const STEP_STATUS = \[([\s\S]*?)\] as const/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(statuses.length, 3);
  assert.ok(statuses.every((s) => /Step \d of 3/.test(s)));
  assert.match(source, /aria-live="polite">\{STEP_STATUS\[step\]\}/);
});

test("workflow is mock-only and keeps the story creative", () => {
  assert.doesNotMatch(code, /fetch\(|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /—/, "no em dashes in source");
  assert.match(source, /YOUR NEXT HOME/);
  assert.match(source, /YOUR SUBIACO HOME/);
  assert.match(source, /subiaco-townhouse\.webp/);
  assert.doesNotMatch(source, /Poolside guide|POOL DAYS/);
});
