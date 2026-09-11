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

  // One pass that ends, so nothing animates forever.
  assert.match(source, /Math\.min\(current \+ 1, STORY_STATUS\.length - 1\)/);
  assert.doesNotMatch(source, /current >= STORY_STATUS\.length - 1 \? 0 : current \+ 1/);
});

test("the story starts once when scrolled into view and then stops", () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /if \(entry\.isIntersecting && !reduceMotion && !hasStarted\.current\)/);
  assert.match(source, /hasStarted\.current = true/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /if \(!playing \|\| !inView \|\| !pageVisible \|\| reduceMotion\) return/);
  assert.match(source, /setPhase\(STORY_STATUS\.length - 1\)/);
  // Nothing can restart it: the transport control is gone.
  assert.doesNotMatch(source, /hc-process-demo-transport|toggleTransport|Replay|Pause the demo/);
  assert.doesNotMatch(styles, /hc-process-demo-transport/);
});

test("screen one is a single row carousel of real ready-made ads", () => {
  // The library is real product output, declared once in the content module.
  assert.match(content, /export const AD_LIBRARY = \[/);
  const library = content.match(/export const AD_LIBRARY = \[([\s\S]*?)\] as const;/)[1];
  const ads = [...library.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ads.length >= 6, `expected a library of real ads, found ${ads.length}`);
  assert.equal(new Set(ads).size, ads.length, "library entries are unique");
  assert.ok(ads.includes("appraisal"), "the selected ad is part of the library");
  assert.match(source, /withBasePath\(ad\.image\)/);

  // One row, with the track sliding so the active card stays centred.
  assert.match(source, /className="hc-library-window"/);
  assert.match(source, /className="hc-library-track"/);
  assert.match(source, /animate=\{\{ x: -shift \}\}/);
  assert.match(source, /const centred = card\.offsetLeft \+ card\.offsetWidth \/ 2 - view\.clientWidth \/ 2/);
  assert.match(source, /Math\.min\(Math\.max\(centred, 0\), limit\)/);
  assert.match(styles, /\.hc-library-track \{[^}]*display: flex/);
  assert.match(styles, /\.hc-library-card \{[^}]*flex: 0 0/);
  // A soft edge, because a hard crop reads as a mistake.
  assert.match(styles, /\.hc-library-window \{[^}]*mask: linear-gradient\(90deg/);

  // The selector lives inside the track, so it always travels with its card.
  assert.match(source, /className="hc-library-track"[\s\S]*?hc-library-selector/);

  // One frame visits the sequence, then settles on the chosen ad.
  assert.match(source, /const LIBRARY_SEQUENCE = \[0, 1, 2, 3\] as const/);
  assert.match(source, /const selected = phase >= SELECTED_PHASE/);
  assert.match(source, /hc-library-check/);

  // The old sliding strip that lost the selected card is gone for good.
  assert.doesNotMatch(source, /hc-story-template-track|hc-story-template-window|hc-story-template-card/);
  assert.doesNotMatch(source, /hc-library-grid/);
});

test("choose, customise and review are one working segmented control", () => {
  // Same control pattern as the reporting section: a measured sliding pill.
  assert.match(source, /className="hc-process-steps"[\s\S]*?role="group"/);
  assert.match(source, /className="hc-process-step-indicator"/);
  assert.match(source, /setIndicator\(\{ left: button\.offsetLeft, width: button\.offsetWidth \}\)/);
  assert.match(source, /aria-pressed=\{activeStep === index\}/);
  assert.match(source, /onClick=\{\(\) => selectStep\(index\)\}/);
  assert.match(source, /setPhase\(STORY_STEP_PHASES\[nextStep\]\)/);

  assert.match(styles, /\.hc-process-steps \{[^}]*border-radius: 999px/);
  assert.match(styles, /\.hc-process-steps button\[aria-pressed="true"\]/);
  assert.match(styles, /\.hc-process-step-indicator \{[^}]*background: #fff/);
  assert.match(styles, /\.hc-process-steps button:focus-visible/);

  // The old dot-marker list is gone.
  assert.doesNotMatch(source, /hc-process-step-mark/);
  assert.doesNotMatch(styles, /hc-process-step-mark/);
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
  // Still a self-contained mock.
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
