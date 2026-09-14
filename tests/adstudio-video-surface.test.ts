import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

/**
 * Strip comments before asserting on behaviour. Prose that explains a rule
 * (for example a comment saying a download is not a publish) must not be able
 * to satisfy or break a check about the code itself.
 */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const page = "src/app/(customer)/ad-studio/video/page.tsx";
const component = "src/components/adstudio/video/video-home.tsx";
const shell = "src/components/adstudio/studio-shell.tsx";

test("the Video surface is reachable from Ad Studio navigation", () => {
  const nav = read(shell);
  assert.match(nav, /href: "\/ad-studio\/video"/, "Studio nav must link to the video route");
  assert.match(nav, /label: "Video"/);
});

test("the free path states that it is free, next to its own action", () => {
  const source = read(component);
  assert.match(source, /There is no charge for this\./);
});

test("the paid path states price, deliverable, deadline, revisions and refunds", () => {
  const source = read(component);
  for (const label of ["Price", "Deliverable", "Draft due", "Revisions", "Refunds"]) {
    assert.ok(source.includes(label), `the paid decision must state ${label} beside it`);
  }
  assert.match(source, /Full refund before final delivery/);
  assert.match(source, /1080x1920/);
});

test("saving a video never offers a campaign or publish action", () => {
  const source = code(component);
  // Saving is not publishing an ad. The library offers a download only.
  assert.doesNotMatch(source, /Publish/i);
  assert.doesNotMatch(source, /campaign/i);
  assert.match(source, /Download/);
});

test("the library download uses the authorised media route, never a stored path", () => {
  const source = read(component);
  assert.match(source, /row\.mediaHref/);
  // The href must be a reference produced by buildVideoMediaRef, which the page
  // builds from the authorised record.
  const pageSource = read(page);
  assert.match(pageSource, /buildVideoMediaRef\(\{ workspaceId, assetId, objectPath \}\)/);
  assert.doesNotMatch(component, /storage\/v1\/object/, "the client must never build a storage URL");
});

test("only ready customer-visible sources become download links", () => {
  const source = read(page);
  assert.match(source, /\.eq\("visibility", "customer"\)/);
  assert.match(source, /\.eq\("upload_state", "ready"\)/);
});

test("the page reads the customer's own records, so RLS applies", () => {
  const source = read(page);
  assert.match(source, /requirePageSurfaceAccess\("adstudio"\)/);
  assert.match(source, /\.eq\("workspace_id", workspaceId\)/);
  // The service client would bypass RLS, which a customer page must not do.
  assert.doesNotMatch(source, /createSupabaseServiceClient/);
});

test("the deadline is computed on the server so hydration cannot disagree", () => {
  const source = read(page);
  assert.match(source, /nextWorkingDayDeadline\(now\)/);
  assert.match(source, /formatDeadline\(/);
  // The client must not compute its own deadline from the current clock.
  const componentSource = read(component);
  assert.doesNotMatch(componentSource, /nextWorkingDayDeadline/, "the client must not recompute the deadline");
});

test("the upload picker is enabled when it is shown", () => {
  const source = read(component);
  // The file input must not be gated on the project-creation flag, which is the
  // defect that made the first version unable to ever open the picker.
  const inputBlock = source.slice(source.indexOf('type="file"'), source.indexOf('type="file"') + 400);
  assert.match(inputBlock, /disabled=\{busy\}/);
  assert.doesNotMatch(inputBlock, /disabled=\{[^}]*creating/);
});

test("the upload reports a retry and never claims success early", () => {
  const source = read(component);
  assert.match(source, /Retrying, attempt/);
  // Success copy appears only for a ready or needs-optimisation phase.
  assert.match(source, /phase\.kind === "ready"/);
  assert.match(source, /phase\.kind === "needs_optimisation"/);
  // The copy is queued at this point, not finished, so the wording must not
  // claim it already exists.
  assert.match(source, /we are making a lighter copy/);
  assert.match(source, /Your original is\s+kept unchanged/);
});

test("every async surface ships loading, empty and error states", () => {
  const source = read(component);
  assert.match(source, /No videos yet/, "empty state");
  assert.match(source, /role="alert"/, "error state");
  assert.match(source, /Checking the file\./, "processing state");
  assert.match(source, /aria-live="polite"/, "progress is announced");
});
