import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");
const content = await readFile(new URL("../src/lib/homepage-concept/content.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");

test("workflow runs a fixed phase sequence that stops on the live frame", () => {
  const statuses = [...source.match(/const STORY_STATUS = \[([\s\S]*?)\] as const/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(statuses.length, 9);
  assert.equal(statuses.at(-1), "Campaign approved. The ad is live.");
  assert.equal(statuses[0], "Choosing an ad. Browsing ready-made ads.");
  assert.equal(statuses[3], "Ad selected.");

  // A hold of null means the phase waits for the text to finish being written.
  const holds = source.match(/const STORY_HOLDS[^=]*= \[([^\]]+)\]/)[1].split(",").map((value) => value.trim());
  assert.equal(holds.length, statuses.length);
  assert.ok(holds.every((hold) => hold === "null" || Number(hold) > 0), `bad hold: ${holds}`);
  assert.equal(holds[5], "null", "the post copy phase is paced by the typing");
  assert.equal(holds[6], "null", "the link title phase is paced by the typing");
  // The button is pressed on the last phase, which is also where the ad goes live.
  assert.match(source, /const PRESS_PHASE = STORY_HOLDS\.length - 1/);
  assert.match(source, /approved=\{phase >= PRESS_PHASE\}/);

  // The three visitor steps still map onto the nine phases.
  const stepPhases = source.match(/const STORY_STEP_PHASES = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.deepEqual(stepPhases, [0, 4, 7]);
  assert.match(source, /const activeStep = STORY_PHASE_TO_STEP\[phase\]/);

  // One pass that ends, so nothing animates forever.
  assert.match(source, /if \(current >= STORY_STATUS\.length - 1\)/);
  assert.doesNotMatch(source, /current >= STORY_STATUS\.length - 1 \? 0 : current \+ 1/);
});

test("the text is written a character at a time, in the field and the ad together", () => {
  // One counter per text, driving both surfaces, so they cannot drift apart.
  assert.match(source, /function useTypewriter\(\{ run, text, at, past, speed, onComplete \}/);
  assert.match(source, /setChars\(index\)/);
  assert.match(source, /STORY_AD\.postCopy\.slice\(0, copyChars\)/);
  assert.match(source, /STORY_AD\.linkTitle\.slice\(0, linkChars\)/);

  // Nothing types until its phase arrives, and stepping back clears it.
  assert.match(source, /run: phase >= 5/);
  assert.match(source, /run: phase >= 6/);
  assert.match(source, /if \(!run \|\| !text\) \{\s*setChars\(0\)/);
  assert.match(source, /const typing = run && at === past && chars < text\.length/);
  // A step change mid-write hands the text over rather than retyping it.
  assert.match(source, /if \(at !== past\) \{\s*setChars\(text\.length\)/);
  // Only the phase that is still current may move the story on.
  assert.match(source, /if \(current !== from\) return current/);

  // The caret rides at the write position without moving the text: no advance
  // width, no line box, and it blends rather than strobing.
  assert.match(styles, /\.hc-story-caret \{[^}]*width: 0/);
  assert.match(styles, /\.hc-story-caret \{[^}]*margin-left: -1px/);
  assert.match(styles, /\.hc-story-caret \{[^}]*animation: hc-story-caret 1s ease-in-out/);
  assert.doesNotMatch(styles, /@keyframes hc-story-caret \{\s*0%, 48%/);
  // The surfaces it writes into reserve their finished height, so no character
  // can change the height of the frame mid-write.
  assert.match(styles, /\.hc-field > strong \{[^}]*box-sizing: border-box/);
  assert.match(styles, /\.hc-story-ad \.hc-meta-feed-copy \{[^}]*box-sizing: border-box/);
  const speeds = [...source.matchAll(/const TYPE_SPEED_\w+ = (\d+)/g)].map((match) => Number(match[1]));
  assert.equal(speeds.length, 2);
  assert.ok(speeds.every((speed) => speed >= 20 && speed <= 60), `typing speed out of range: ${speeds}`);
  // The two writing fields must be slower than a machine tick.
  assert.match(source, /const TYPE_SPEED_COPY = 24/);
  assert.match(source, /const TYPE_SPEED_LINK = 40/);
  // Pacing is jittered, never on a fixed period: a stall on every nth character
  // reads as the animation stuttering.
  assert.match(source, /const jitter = speed \* 0\.45/);
  assert.match(source, /const pause = Math\.random\(\) < 0\.18/);
  assert.doesNotMatch(source, /index % 5 === 0 \? 26 : 0/);
  assert.match(source, /const REVIEW_ITEM_SPEED = 19/);

  // A step jumped to ahead of the writing still shows a finished ad.
  assert.match(source, /const copyChars = scene === "browse" \? 0 : phase > 5 \? STORY_AD\.postCopy\.length/);
  assert.match(source, /const linkChars = scene === "browse" \|\| phase < 6 \? 0 : phase > 6 \? STORY_AD\.linkTitle\.length/);
});

test("the field writes the ad headline onto the image", () => {
  // The same counter drives a layer on the creative, so the field writes on the ad.
  assert.match(source, /className=\{`hc-story-ad-headline\$\{writingLink \? " is-writing" : ""\}`\}/);
  assert.match(source, /className="hc-story-ad-headline-text"/);
  assert.match(source, /STORY_AD\.adTitle\.slice\(0, linkChars\)[\s\S]{0,200}hc-story-caret/);
  assert.match(styles, /\.hc-story-ad-image \{[^}]*container-type: inline-size/);
  // It sits on the template's own link title line, sized against the creative.
  assert.match(styles, /\.hc-story-ad-headline \{[^}]*position: absolute/);
  assert.match(styles, /\.hc-story-ad-headline \{[^}]*text-transform: uppercase/);
  // The demo creative is a pack render with no text on the artwork, so the
  // headline the visitor writes is the only headline on the ad.
  assert.match(content, /image: "\/adstudio-fixtures\/meta-agent-intro-feed-037\/property-photo\.webp"/);
  assert.doesNotMatch(content, /f1eef3fb49b782ab7666cd14a7f793151f5fd439c724085ce68996e9ebb24f78/);
  // Set on the image like real ad type: display type on a scrim, no panel.
  assert.match(styles, /\.hc-story-ad-headline \{[^}]*color: #fff/);
  assert.match(styles, /\.hc-story-ad-headline \{[^}]*font-style: normal/);
  assert.match(styles, /\.hc-story-ad-headline \{[^}]*text-transform: uppercase/);
  assert.match(styles, /\.hc-story-ad-headline \{[^}]*text-shadow/);
  assert.doesNotMatch(styles, /\.hc-story-ad-headline \{[^}]*background: #fefefe/);
  // A scrim over the photo gives the type something to sit on.
  assert.match(styles, /\.hc-story-ad-image::after \{[^}]*linear-gradient\(180deg/);
  // The short accent rule a finished template sets above its headline.
  assert.match(styles, /\.hc-story-ad-rule \{/);
});

test("the review step writes its values, presses, and puts the ad live", () => {
  // The three confirmed values are written one character at a time.
  assert.match(source, /const REVIEW_FIELDS = \[/);
  assert.match(source, /function useTypedReview\(start: boolean, reduceMotion: boolean\)/);
  assert.match(source, /value\.slice\(0, counts\[index\]\)/);
  assert.match(source, /useTypedReview\(phase >= 7, reduceMotion\)/);

  // The press is a real press: the button dips and the ad takes the motion.
  assert.match(source, /const pressing = phase === PRESS_PHASE/);
  assert.match(source, /scale: \[1, 1\.035, 0\.995, 1\], y: \[0, -8, 0, 0\]/);
  assert.match(source, /animate=\{pressing \? \{ scale: \[1, 0\.94, 1\] \}/);
  // The press reads from the button and the ad, with no fake pointing hand.
  assert.doesNotMatch(source, /StoryCursor|hc-story-cursor/);
  assert.doesNotMatch(styles, /hc-story-cursor/);

  // Approved: green button, live tag on the ad, live toast.
  assert.match(source, /hc-story-approve\$\{approved \? " is-approved" : ""\}/);
  assert.match(source, /hc-story-ad-live/);
  assert.match(source, /Campaign is live/);
  assert.match(styles, /\.hc-story-ad-live \{[^}]*background: var\(--hc-green\)/);
  assert.match(styles, /\.hc-story-approve\.is-approved \{[^}]*background: var\(--hc-green\)/);
  // The live tag pulses, and the pulse can be found.
  assert.match(styles, /@keyframes hc-story-live-pulse/);
});

test("the copy column leads with the offer and nothing else", () => {
  // Two lines, the second in the hero's blue, and no eyebrow above it.
  assert.match(source, /<span>Lead generating ads for<\/span>/);
  assert.match(source, /<span className="hc-process-prompt">Facebook &amp; Instagram<\/span>/);
  assert.doesNotMatch(source, /hc-process-eyebrow/);
  assert.doesNotMatch(styles, /hc-process-eyebrow/);
  assert.match(styles, /\.hc-process-copy h2 > span \{\s*display: block/);
  assert.match(styles, /\.hc-process-prompt \{\s*color: var\(--hc-blue-bright\)/);
  // The note matches the real offer wording.
  assert.match(source, /Free trial · No card required · Cancel anytime/);
  assert.doesNotMatch(source, /Free 14-day trial/);
});

test("scenes cross-fade symmetrically and the ad morphs only into the editor", () => {
  // All three scenes stay mounted and cross-fade on one CSS transition, so the
  // swap is a single interpolation rather than a mount/unmount race.
  assert.match(styles, /\.hc-story-scene \{[^}]*opacity: 0/);
  assert.match(styles, /\.hc-story-scene \{[^}]*transition:/);
  assert.match(styles, /\.hc-story-scene\.is-active \{[^}]*opacity: 1/);
  // The swap is one gesture: the outgoing screen leaves faster than the
  // incoming one settles, and both travel the same short distance.
  assert.match(styles, /opacity 220ms cubic-bezier\(\.4, 0, \.2, 1\)/);
  assert.match(styles, /opacity 320ms cubic-bezier\(\.4, 0, \.2, 1\)/);
  assert.match(styles, /--scene-shift: 14px/);
  assert.match(styles, /transform: translate3d\(calc\(var\(--scene-shift\) \* -1\), 0, 0\)/);
  assert.match(source, /className=\{`hc-story-scene hc-story-library\$\{active \? " is-active" : ""\}`\}/);
  assert.match(source, /className=\{`hc-story-scene hc-story-editor\$\{active \? " is-active" : ""\}`\}/);
  assert.match(source, /className=\{`hc-story-scene hc-story-review\$\{active \? " is-active" : ""\}`\}/);
  assert.doesNotMatch(source, /<AnimatePresence mode="sync" initial=\{false\}>\s*\{scene ===/);
  assert.match(source, /active=\{scene === "browse"\}/);
  assert.match(source, /active=\{scene === "edit"\}/);
  assert.match(source, /active=\{scene === "review"\}/);
  // The creative morphs library -> editor and nowhere else, so the review
  // settle is a pure fade rather than a fade plus a slide.
  assert.match(source, /layoutId=\{morph \? "story-ad" : undefined\}/);
  assert.match(source, /morph=\{false\}/);
});

test("reduced motion drops the movement and keeps the fades", () => {
  assert.match(source, /const REDUCED_FADE_IN = \{ duration: 0\.28, ease: "linear" \}/);
  assert.match(source, /transition=\{reduceMotion \? REDUCED_FADE_IN :/);
  // The press still registers, without travelling.
  assert.match(source, /reduceMotion\s*\? \{ scale: \[1, 0\.99, 1\] \}/);
});

test("the demo card keeps one size and the scenes change inside it", () => {
  // One height token, no per-scene viewport height and no height animation.
  assert.match(styles, /--hc-demo-height: 600px/);
  assert.match(styles, /\.hc-story-viewport \{[^}]*height: var\(--hc-demo-height\)/);
  assert.doesNotMatch(styles, /\.hc-process-demo\[data-scene="browse"\] \.hc-story-viewport/);
  assert.doesNotMatch(styles, /transition: height/);
  for (const width of ["1100px", "600px"]) {
    assert.match(styles, new RegExp(`@media \\(max-width: ${width}\\)`));
  }
  const heights = [...styles.matchAll(/--hc-demo-height: (\d+)px/g)].map((match) => Number(match[1]));
  assert.equal(heights.length, 3, "one height for each of the three breakpoints");
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b), "the frame only grows as the screen narrows");

  // Every scene fills the frame and centres its own block inside it.
  assert.match(styles, /\.hc-story-scene \{[^}]*position: absolute[^}]*inset: 0/);
  assert.match(styles, /\.hc-story-review \{[^}]*align-content: center/);
  assert.match(styles, /\.hc-story-editor \{[^}]*align-content: center/);
});

test("the highlight is green everywhere, with a green fill", () => {
  assert.match(styles, /\.hc-process-demo \{\s*--scene-accent: var\(--hc-green\);\s*--scene-soft: #e3f5eb;/);
  // The old amber customise accent is gone for good.
  assert.doesNotMatch(styles, /#d99a1a|#fbf1d9/);
  assert.match(styles, /\.hc-field\.is-active > strong \{[^}]*background: var\(--scene-soft\)/);
  assert.match(styles, /\.hc-library-selector\.is-selected \{[^}]*border-color: var\(--scene-accent\)/);
  assert.match(styles, /\.hc-process-steps button\[aria-pressed="true"\] \{\s*color: var\(--scene-accent\)/);
  assert.match(styles, /\.hc-process-step-indicator \{[^}]*background: var\(--scene-soft\)/);
});

test("the story starts once when scrolled into view and then stops", () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /hasStarted\.current = true/);
  assert.match(source, /visibilitychange/);
  // The story waits until the reader has arrived: most of the section has to be
  // on screen, and then they get a beat before the first frame moves. A low
  // threshold ran it while they were still reading the headline.
  assert.match(source, /const STORY_START_THRESHOLD = 0\.6/);
  assert.match(source, /const STORY_START_DELAY_MS = 1200/);
  assert.match(source, /\{ threshold: STORY_START_THRESHOLD \}/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]{0,200}STORY_START_DELAY_MS/);
  assert.doesNotMatch(source, /threshold: 0\.12/);
  // A phone viewport is shorter than the section, so the start must not be
  // gated on a fraction the viewport cannot reach.
  assert.ok(0.6 < 0.68, "phone visible fraction must clear the start threshold");
  assert.match(source, /if \(!playing \|\| !inView \|\| !pageVisible\) return/);
  // Reduced motion shortens the run instead of stranding the story mid-way.
  assert.match(source, /reduceMotion \? 260 : hold/);
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
  // The window clips the row: without it the row paints outside the card.
  assert.match(styles, /\.hc-library-window \{[^}]*overflow: hidden/);
  assert.doesNotMatch(styles, /\.hc-library-window \{[^}]*overflow: visible/);
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

test("choose, customise and review are one working control in the card header", () => {
  // Same control pattern as the reporting section: a measured sliding pill,
  // now sitting in the demo card's top right rather than beside the headline.
  assert.match(source, /className="hc-process-demo-topbar"[\s\S]*?className="hc-process-stage"[\s\S]*?className="hc-process-steps"[\s\S]*?role="group"/);
  assert.match(source, /className="hc-process-step-indicator"/);
  assert.match(source, /setIndicator\(\{ left: button\.offsetLeft, width: button\.offsetWidth \}\)/);
  assert.match(source, /aria-pressed=\{activeStep === index\}/);
  assert.match(source, /onClick=\{\(\) => selectStep\(index\)\}/);
  assert.match(source, /setPhase\(STORY_STEP_PHASES\[nextStep\]\)/);

  assert.match(styles, /\.hc-process-steps \{[^}]*border-radius: 999px/);
  assert.match(styles, /\.hc-process-steps button\[aria-pressed="true"\]/);
  assert.match(styles, /\.hc-process-step-indicator \{[^}]*background: var\(--scene-soft\)/);
  assert.match(styles, /\.hc-process-steps button:focus-visible/);
  // The control no longer sits under the headline in the copy column.
  assert.doesNotMatch(source, /hc-process-copy[\s\S]{0,400}hc-process-steps/);

  // The old dot-marker list is gone.
  assert.doesNotMatch(source, /hc-process-step-mark/);
  assert.doesNotMatch(styles, /hc-process-step-mark/);
});

test("each stage carries one short brief under the header", () => {
  const briefs = [...source.matchAll(/\{ label: "([^"]+)", hint: "([^"]+)" \}/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(briefs.map(([label]) => label), ["Choose", "Customise", "Review"]);
  for (const [, hint] of briefs) {
    assert.ok(hint.length > 0 && hint.length <= 48, `brief should stay short: ${hint}`);
    assert.ok(!/[\u2014]/.test(hint), "no em dash in customer copy");
  }
  // The brief follows the active step, so it always describes what is on screen.
  assert.match(source, /className="hc-process-brief"/);
  assert.match(source, /PROCESS_STEPS\[activeStep\]\.hint/);
  assert.match(styles, /\.hc-process-brief \{[^}]*color: var\(--hc-muted\)/);
});

test("screen two hands the chosen ad to the left and writes the fields on the right", () => {
  assert.match(source, /className="hc-story-ad-workspace"/);
  assert.match(source, /className="hc-story-edit-panel"/);
  assert.match(source, /<h3>Make it yours<\/h3>/);

  // Both fields start empty and say what to write, so nothing reads as broken.
  assert.match(source, /data-empty=\{copyChars === 0 \? "true" : undefined\}/);
  assert.match(source, /data-empty=\{linkChars === 0 \? "true" : undefined\}/);
  assert.match(source, /Write your post copy/);
  assert.match(source, /Add a link title/);
  assert.match(styles, /\.hc-field\[data-empty="true"\] > strong/);

  // The chosen creative and the ad share one morph, so it travels across. The
  // ids are conditional so the morph runs only on that journey.
  assert.match(source, /layoutId=\{morph \? "story-ad-creative" : undefined\}/);
  assert.match(source, /layoutId=\{morph \? "story-ad" : undefined\}/);
});

test("the demo edits a real ad instead of inventing copy", () => {
  assert.match(source, /const SELECTED_AD = \{ \.\.\.AD_EXAMPLES\[0\]/);
  assert.match(source, /STORY_AD\.postCopy/);
  assert.match(source, /STORY_AD\.linkTitle/);
  assert.match(content, /adTitle: "/);
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
