import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");

test("workflow restores the full ordered sequence separately from the hero", () => {
  const statuses = [...source.match(/const STORY_STATUS = \[([\s\S]*?)\] as const/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(statuses, [
    "Choose a template", "Template selected", "Customise the ad", "Editing the post copy",
    "Editing text on the creative", "Review campaign", "Campaign details filled",
    "Approve campaign", "Campaign approved",
  ]);
  const delays = source.match(/const STORY_PHASE_DELAYS = \[([^\]]+)\]/)[1].split(",").map(Number);
  assert.equal(delays.length, statuses.length);
  assert.ok(delays.every((delay) => delay > 0));
  assert.match(source, /const valuesFilled = phase >= 6/);
  assert.match(source, /const pressing = phase === 7/);
  assert.match(source, /const approved = phase >= 8/);
  assert.match(source, /layoutId="story-ad"/);
  assert.match(source, /layoutId="story-template-image"/);
  assert.match(source, /Array\.from\(STORY_CREATIVE.editedOverlay\)/);
  assert.match(source, /YOUR NEXT HOME/);
  assert.match(source, /YOUR SUBIACO HOME/);
  assert.match(source, /subiaco-townhouse\.webp/);
  assert.doesNotMatch(source, /Poolside guide|POOL DAYS/);
});

test("workflow is mock-only, continuously loops and respects motion/visibility", () => {
  assert.match(source, /current >= STORY_STATUS.length - 1 \? 0 : current \+ 1/);
  assert.match(source, /setPlaying\(!reduceMotion\)/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /if \(!playing \|\| !inView \|\| !pageVisible \|\| reduceMotion\) return/);
  assert.match(source, /setPhase\(STORY_STATUS.length - 1\)/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|Replay|Pause|—/);
  assert.match(source, /<motion\.strong[\s\S]*?hc-story-approve/);
});
