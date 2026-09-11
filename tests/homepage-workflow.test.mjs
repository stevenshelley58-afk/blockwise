import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");
const content = await readFile(new URL("../src/lib/homepage-concept/content.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");

test("workflow runs a fixed nine-phase sequence that stops on the approved frame", () => {
  const statuses = [...source.match(/const STORY_STATUS = \[([\s\S]*?)\] as const/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(statuses.length, 9);
  assert.equal(statuses[0], "Choosing an ad. Browsing ready-made ads.");
  assert.equal(statuses[3], "Ad selected.");
  assert.equal(statuses.at(-1), "Campaign approved.");

  const delays = source.match(/const STORY_PHASE_DELAYS = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.equal(delays.length, statuses.length);
  assert.ok(delays.every((delay) => delay > 0));

  // The three visitor steps still map onto the nine phases.
  const stepPhases = source.match(/const STORY_STEP_PHASES = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.deepEqual(stepPhases, [0, 4, 7]);
  assert.match(source, /const activeStep = STORY_PHASE_TO_STEP\[phase\]/);

  // The story ends on the final frame instead of wrapping, so nothing animates
  // forever and the live region stops announcing.
  assert.match(source, /Math\.min\(current \+ 1, STORY_STATUS\.length - 1\)/);
  assert.doesNotMatch(source, /current >= STORY_STATUS\.length - 1 \? 0 : current \+ 1/);
});

test("screen one shows real ready-made ads behind one travelling selector", () => {
  // The library is real product output, declared once in the content module.
  assert.match(content, /export const AD_LIBRARY = \[/);
  const library = content.match(/export const AD_LIBRARY = \[([\s\S]*?)\] as const;/)[1];
  const ads = [...library.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ads.length >= 6, `expected a library of real ads, found ${ads.length}`);
  assert.equal(new Set(ads).size, ads.length, "library entries are unique");
  assert.ok(ads.includes("appraisal"), "the selected ad is part of the library");
  assert.match(source, /withBasePath\(ad\.image\)/);

  // One selector frame visits the sequence, then settles on the chosen ad.
  assert.match(source, /const LIBRARY_SEQUENCE = \[0, 1, 2, 3\] as const/);
  assert.match(source, /const selected = phase >= SELECTED_PHASE/);
  assert.match(source, /className=\{`hc-library-selector/);
  assert.match(source, /animate=\{\{ x: frame\.x, y: frame\.y, width: frame\.width, height: frame\.height \}\}/);
  assert.match(source, /hc-library-check/);

  // The old sliding track is gone: it moved the chosen card out of the window
  // while the heading still claimed a template was selected.
  assert.doesNotMatch(source, /hc-story-template-track|hc-story-template-window/);
  assert.doesNotMatch(source, /hc-story-template-card/);
});

test("screen two hands the chosen ad to the left and opens empty fields on the right", () => {
  assert.match(source, /className="hc-story-ad-workspace"/);
  assert.match(source, /className="hc-story-edit-panel"/);
  assert.match(source, /<h3>Make it yours<\/h3>/);

  // Both fields start empty and say what to write, so nothing reads as broken.
  assert.match(source, /data-empty=\{copyWritten \? undefined : "true"\}/);
  assert.match(source, /data-empty=\{linkWritten \? undefined : "true"\}/);
  assert.match(source, /Write your post copy/);
  assert.match(source, /Add a link title/);
  assert.match(styles, /\.hc-field\[data-empty="true"\] > strong/);

  // The chosen creative and the ad share one morph, so it travels across.
  assert.match(source, /layoutId="story-ad-creative"/);
  assert.match(source, /layoutId="story-ad"/);
});

test("the demo edits a real ad instead of inventing copy", () => {
  assert.match(source, /const SELECTED_AD = \{ \.\.\.AD_EXAMPLES\[0\]/);
  assert.match(source, /STORY_AD\.postCopy/);
  assert.match(source, /STORY_AD\.linkTitle/);
  // The headline account matches the agent shown inside the creative.
  assert.match(source, /account: "Alex Morgan Property"/);
  assert.match(source, /domain: "ALEXMORGAN\.COM\.AU"/);
  // No fabricated performance claims in the preview.
  assert.doesNotMatch(source, /guarantee|ROI|cost per lead|\d+ (new )?leads/i);
  // The typed image overlay is gone; the real creative carries its own text.
  assert.doesNotMatch(source, /YOUR NEXT HOME|YOUR SUBIACO HOME|editedOverlay|hc-story-creative-overlay/);
});

test("the preview stays a mock, gated on motion and viewport, and can be paused", () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /if \(!playing \|\| !inView \|\| !pageVisible \|\| reduceMotion\) return/);
  assert.match(source, /setPhase\(STORY_STATUS\.length - 1\)/);
  assert.match(source, /setPlaying\(!reduceMotion && nextStep < PROCESS_STEPS\.length - 1\)/);

  // WCAG 2.2.2: an auto-starting preview needs a pause and replay control.
  assert.match(source, /hc-process-demo-transport/);
  assert.match(source, /finished \? "Replay the demo" : playing \? "Pause the demo" : "Play the demo"/);

  // Self-contained: no network, no storage, no analytics.
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|XMLHttpRequest|analytics/i);
});

test("preview text keeps a readable floor and never uses the faint token for text", () => {
  const sizes = [...styles.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 0);
  const smallest = Math.min(...sizes);
  assert.ok(smallest >= 10, `preview text dropped to ${smallest}px`);

  // --hc-faint resolves to 2.95:1 on the preview surfaces, so it is border-only.
  assert.doesNotMatch(styles, /(?:^|[\s;{])color:\s*var\(--hc-faint\)/m);
});
