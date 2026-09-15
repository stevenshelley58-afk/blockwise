import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createAutosaveController } from "../../src/components/adbuilder/vue-editor/autosave-controller.ts";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("rapid edits debounce to one save", async () => {
  let saves = 0;
  const controller = createAutosaveController(async () => { saves += 1; }, 20);
  controller.edit(); controller.edit(); controller.edit();
  await wait(35);
  assert.equal(saves, 1);
  controller.dispose();
});

test("one in-flight save coalesces a newer edit into one follow-up", async () => {
  let saves = 0;
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const controller = createAutosaveController(async () => {
    saves += 1;
    if (saves === 1) await first;
  }, 20);
  controller.edit();
  await wait(30);
  controller.edit();
  await wait(25);
  assert.equal(saves, 1);
  release();
  await wait(30);
  assert.equal(saves, 2);
  controller.dispose();
});

test("late completion keeps a newer edit eligible and dirty", async () => {
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const controller = createAutosaveController(async () => first, 10);
  controller.edit();
  await wait(20);
  controller.edit();
  assert.equal(controller.getState().inFlight, true);
  release();
  await wait(20);
  assert.equal(controller.getState().version, 2);
  assert.equal(controller.getState().attemptedVersion, 2);
  controller.dispose();
});

test("failed attempt does not loop until a new edit", async () => {
  let saves = 0;
  const controller = createAutosaveController(async () => { saves += 1; throw new Error("offline"); }, 10);
  controller.edit();
  await wait(20);
  await wait(30);
  assert.equal(saves, 1);
  controller.edit();
  await wait(20);
  assert.equal(saves, 2);
  controller.dispose();
});

test("disabled controller pauses and resumes pending autosave", async () => {
  let saves = 0;
  const controller = createAutosaveController(async () => { saves += 1; }, 20);
  controller.setEnabled(false);
  controller.edit();
  await wait(30);
  assert.equal(saves, 0);
  controller.setEnabled(true);
  await wait(30);
  assert.equal(saves, 1);
  controller.dispose();
});

test("native shell uses the autosave controller for dirty edits", () => {
  const source = readFileSync("src/components/adbuilder/vue-editor/vue-editor-shell.tsx", "utf8");
  assert.match(source, /import \{ createAutosaveController \} from ".\/autosave-controller"/);
  assert.match(source, /createAutosaveController\(\(\) => saveAction\.current\(\)\)/);
  assert.match(source, /autosaveController\.current\?\.edit\(\)/);
});
