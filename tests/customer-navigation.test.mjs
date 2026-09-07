import assert from "node:assert/strict";
import test from "node:test";
import { blockwise } from "../src/config/niche/blockwise.ts";
import { activeRouteHref } from "../src/lib/navigation/active-nav-item.ts";

test("navigation picks exactly the deepest destination and respects path boundaries", () => {
  const items = [{ href: "/ad-studio" }, { href: "/ad-studio/brand" }, { href: "/settings" }];
  assert.equal(activeRouteHref("/ad-studio/brand", items), "/ad-studio/brand");
  assert.equal(activeRouteHref("/ad-studio/brand/edit", items), "/ad-studio/brand");
  assert.equal(activeRouteHref("/ad-studio/templates", items), "/ad-studio");
  assert.equal(activeRouteHref("/settings/profile", items), "/settings");
  assert.equal(activeRouteHref("/settings-other", items), undefined);
  assert.equal(activeRouteHref("/unknown", items), undefined);
  assert.equal(activeRouteHref("/settings", [{ href: "/settings?tab=account" }]), "/settings?tab=account");
});

test("the customer registry declares unique destinations and at most five mobile tabs", () => {
  const items = blockwise.nav.items;
  assert.equal(new Set(items.map(item => item.href)).size, items.length);
  assert.ok(items.every(item => item.icon && item.label));
  const tabs = items.filter(item => item.mobileLabel && (!item.feature || blockwise.features[item.feature]));
  assert.ok(tabs.length > 0 && tabs.length <= 5);
  assert.deepEqual(tabs.map(item => item.href), ["/self-serve", "/ad-studio", "/results", "/leads"]);
});


test("disabled customer tools remain declared but are excluded from active navigation", () => {
  const disabled = blockwise.nav.items.filter(
    (item) => item.feature && !blockwise.features[item.feature],
  );
  assert.deepEqual(
    disabled.map(({ href, feature }) => [href, feature]),
    [["/ad-radar", "adRadar"], ["/property-check", "propertyCheck"]],
  );

  const active = blockwise.nav.items.filter(
    (item) => !item.feature || blockwise.features[item.feature],
  );
  assert.equal(active.some((item) => item.href === "/ad-radar"), false);
  assert.equal(active.some((item) => item.href === "/property-check"), false);
});
