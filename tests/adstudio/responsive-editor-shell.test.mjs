import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");

test("mounts exactly one inspector implementation for the active breakpoint", () => {
  assert.match(source, /window\.matchMedia\("\(min-width: 1280px\)"\)/);
  assert.match(source, /desktopMedia\.addEventListener\("change", syncInspectorViewport\)/);
  assert.match(source, /desktopMedia\.removeEventListener\("change", syncInspectorViewport\)/);
  assert.match(source, /isDesktopInspector === true \? <aside aria-label="Editor inspector"/);
  assert.match(source, /isDesktopInspector === false \? <>[\s\S]*?<nav[\s\S]*?<Sheet open=\{mobileInspectorOpen\}/);
  assert.match(source, /if \(isDesktopInspector\) setMobileInspectorOpen\(false\)/);

  assert.doesNotMatch(source, /className="hidden[^\"]*xl:block"/);
  assert.doesNotMatch(source, /className="[^\"]*xl:hidden" aria-label="Editor tools"/);
  assert.doesNotMatch(source, /<SheetContent[^>]*xl:hidden/);
});

test("uses an accessible icon-only Save control at 320px", () => {
  assert.match(source, /aria-label=\{state\.isSaving \? "Saving" : "Save"\}/);
  assert.match(source, /title=\{state\.isSaving \? "Saving" : "Save"\}/);
  assert.match(source, /<span className="hidden truncate min-\[360px\]:inline">\{state\.isSaving \? "Saving…" : "Save"\}<\/span>/);
  assert.match(source, /<Save aria-hidden="true" className="size-4 shrink-0 min-\[360px\]:ml-1\.5" \/>/);
});
