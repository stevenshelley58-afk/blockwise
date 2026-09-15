import assert from "node:assert/strict";
import test from "node:test";
import { guardedEditorNavigationHref } from "../../src/components/adbuilder/editor/editor-navigation.ts";

const currentHref = "https://app.blockwise.test/ad-builder/ads/ad-1?workspaceId=workspace-1";
const regularIntent = { currentHref, button: 0, defaultPrevented: false, modified: false, target: "", download: false };

test("guards only ordinary same-origin editor navigation", () => {
  assert.equal(guardedEditorNavigationHref({ ...regularIntent, href: "https://app.blockwise.test/performance?view=home" }), "/performance?view=home");
  assert.equal(guardedEditorNavigationHref({ ...regularIntent, href: "https://app.blockwise.test/ad-builder/ads/ad-1?workspaceId=workspace-1#canvas" }), null);
});

test("leaves browser-native new-tab, download, modified, and external links alone", () => {
  const href = "https://app.blockwise.test/performance";
  for (const intent of [
    { ...regularIntent, href, modified: true },
    { ...regularIntent, href, target: "_blank" },
    { ...regularIntent, href, target: "preview-window" },
    { ...regularIntent, href, download: true },
    { ...regularIntent, href, button: 1 },
    { ...regularIntent, href, defaultPrevented: true },
    { ...regularIntent, href: "https://example.test/performance" },
  ]) assert.equal(guardedEditorNavigationHref(intent), null);
});