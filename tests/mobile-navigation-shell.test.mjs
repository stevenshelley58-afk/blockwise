import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { blockwise } from "../src/config/niche/blockwise.ts";
import { canAccessSurface } from "../src/lib/auth/access-control.ts";

const mobileNav = readFileSync("src/components/app/mobile-bottom-nav.tsx", "utf8");
const studioShell = readFileSync("src/components/adstudio/studio-shell.tsx", "utf8");
const selfServeShell = readFileSync("src/components/self-serve-shell.tsx", "utf8");
const legacyShell = readFileSync("src/components/route-aware-legacy-shell.tsx", "utf8");
const globalCss = readFileSync("src/app/globals.css", "utf8");
const consent = readFileSync("src/components/consent-banner.tsx", "utf8");

test("customer mobile navigation keeps the five permanent destinations", () => {
  const tabs = blockwise.nav.items.filter((item) => item.mobileLabel);
  assert.deepEqual(tabs.map((item) => [item.href, item.mobileLabel]), [
    ["/self-serve", "Home"],
    ["/ad-studio", "Ads"],
    ["/results", "Results"],
    ["/leads", "Leads"],
  ]);
  assert.match(mobileNav, /const primaryItems = \[byHref\("\/self-serve"\), byHref\("\/ad-studio"\), byHref\("\/results"\), byHref\("\/leads"\)\]/);
  assert.match(mobileNav, /<span>\{copy\.more\}<\/span>/);
});

test("monitor mobile navigation remains restricted to monitor metadata", () => {
  const monitorSelector = mobileNav.slice(mobileNav.indexOf("function monitorItems"), mobileNav.indexOf("function itemsForVariant"));
  assert.match(mobileNav, /if \(variant === "monitor"\) return monitorItems\(\)/);
  assert.match(monitorSelector, /const allItems = navByVariant.monitor/);
  assert.match(monitorSelector, /const primaryHrefs = \["\/results", "\/leads", "\/settings"\]/);
  assert.doesNotMatch(monitorSelector, /ad-studio|Brand Pack|self_serve/);
  assert.doesNotMatch(mobileNav, /results\?view=home|homeItemHref/);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "self_serve"), false);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "adstudio"), false);
});

test("Ad Studio shares the global mobile frame on every route, including the editor", () => {
  assert.match(studioShell, /<MobileBottomNav variant="self_serve"/);
  assert.match(studioShell, /contextual \? "min-h-0 overflow-hidden pb-\[calc\(5rem\+env\(safe-area-inset-bottom\)\+var\(--consent-banner-height,0px\)\)\]/);
  assert.doesNotMatch(studioShell, /aria-label="Studio mobile navigation"/);
  assert.match(mobileNav, /pathname === "\/ad-studio" \|\| pathname\.startsWith\("\/ad-studio\/"/);
});

test("More owns overflow state and protects editor sign-out", () => {
  assert.match(mobileNav, /const moreActive = moreOpen/);
  assert.match(mobileNav, /aria-current=\{moreCurrent \? "page"/);
  assert.match(mobileNav, /aria-pressed=\{moreActive\}/);
  assert.match(mobileNav, /pathname\.startsWith\("\/ad-studio\/ads\/"\) && !window\.confirm/);
  assert.match(mobileNav, /<Sheet open=\{moreOpen\}/);
  assert.match(selfServeShell, /<MobileBottomNav variant="self_serve"/);
  assert.match(legacyShell, /<MobileBottomNav variant=\{variant\} homeHref=\{homeHref\}/);
});

test("mobile layer order keeps sheets and consent above the persistent bar", () => {
  const navBlock = globalCss.slice(globalCss.indexOf(".mobile-bottom-nav {"), globalCss.indexOf(".mobile-bottom-nav-item {"));
  assert.match(navBlock, /z-index: 40/);
  const consentBlock = globalCss.slice(globalCss.indexOf(".consent-banner {"), globalCss.indexOf(".consent-banner__text {"));
  assert.match(consentBlock, /z-index: 9999/);
  assert.match(globalCss, /bottom: calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(globalCss, /mobile-bottom-nav--customer/);
  assert.match(studioShell, /var\(--consent-banner-height,0px\)/);
  assert.match(consent, /ResizeObserver/);
  assert.match(consent, /--consent-banner-height/);
  assert.match(consent, /role="dialog"\]\[data-state="open"/);
});
