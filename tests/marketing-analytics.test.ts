import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getConsentStatus } from "../src/lib/analytics/consent.ts";
import { isMarketingPath, marketingPageLocation, setGa4Collection, sanitizeMarketingProperties, trackMarketingEvent, validGa4Id, validClarityId } from "../src/lib/analytics/marketing.ts";

test("marketing analytics rejects missing consent and private routes", () => {
  const calls: unknown[][] = [];
  let consent = "essential";
  const stub = { localStorage: { getItem: () => consent }, location: { origin: "https://blockwise.sale", pathname: "/", search: "?email=private@example.com" }, gtag: (...a: unknown[]) => calls.push(a) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: stub });
  try {
    trackMarketingEvent("generate_lead", { form_type: "demo" });
    assert.equal(calls.length, 0);
    consent = "granted";
    for (const path of ["/operator/customers", "/self-serve", "/leads", "/login", "/reset-password", "/auth/callback", "/unknown-private-page"]) {
      stub.location.pathname = path;
      trackMarketingEvent("generate_lead");
    }
    assert.equal(calls.length, 0);
    stub.location.pathname = "/ad-reports/opaque-recipient-token";
    trackMarketingEvent("generate_lead");
    assert.equal(calls.length, 0);
    stub.location.pathname = "/audit/private-id";
    trackMarketingEvent("generate_lead", { form_type: "demo", email: "private@example.com", postcode: "6000", url: "https://example.com" });
    assert.deepEqual(calls, [["event", "generate_lead", { form_type: "demo", page_type: "audit", page_location: "https://blockwise.sale/audit", page_referrer: "", page_title: "audit" }]]);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("consent fails closed when browser storage is unavailable", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem() { throw Error("blocked"); } } } });
  try { assert.equal(getConsentStatus(), null); } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("marketing payloads strip private and malformed values", () => {
  assert.deepEqual(sanitizeMarketingProperties({ email: "a@b.com", name: "A Person", phone: "0400000000", postcode: "6000", cta_location: "Hero Start", method: "a@b.com", source: 6000, form_type: null as never }), { cta_location: "hero_start" });
  assert.equal(marketingPageLocation("https://blockwise.sale", "/suburb/6000"), "https://blockwise.sale/suburb");
  assert.equal(isMarketingPath("/guides/lead-follow-up-playbook"), true);
});

test("provider IDs reject malformed values", () => {
  assert.equal(validGa4Id("G-AB12345678"), true);
  for (const value of ["", "A-12345678", "G-../../private"]) assert.equal(validGa4Id(value), false);
  assert.equal(validClarityId("abcdefgh12"), true);
  assert.equal(validClarityId("abcdefgh?x=1"), false);
});

test("production build and runtime forward the launch switches", () => {
  const docker = readFileSync("infra/product/Dockerfile", "utf8");
  const compose = readFileSync("infra/coolify/docker-compose.product.yml", "utf8");
  for (const name of ["NEXT_PUBLIC_GA4_MEASUREMENT_ID", "NEXT_PUBLIC_CLARITY_PROJECT_ID"]) {
    assert.ok(docker.includes(`ARG ${name}=`));
    assert.ok(docker.includes(`ENV ${name}=$${name}`));
    assert.ok(compose.includes(`${name}: `));
  }
  assert.ok(compose.includes("EMAIL_OUTBOX_DELIVERY_ENABLED: ${EMAIL_OUTBOX_DELIVERY_ENABLED:-false}"));
});

test("GA4 opt-out stops a loaded tag and can re-enable only its configured property", () => {
  const stub: Record<string, boolean> = {};
  Object.defineProperty(globalThis, "window", { configurable: true, value: stub });
  try {
    setGa4Collection("G-AB12345678", false);
    assert.equal(stub["ga-disable-G-AB12345678"], true);
    setGa4Collection("G-AB12345678", true);
    assert.equal(stub["ga-disable-G-AB12345678"], false);
    setGa4Collection(undefined, true);
    setGa4Collection("not-a-property", true);
    assert.deepEqual(Object.keys(stub), ["ga-disable-G-AB12345678"]);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("CSP permits regional GA4 collection without broad HTTPS access", () => {
  const config = readFileSync("next.config.ts", "utf8");
  const connect = config.split("const connectSrc = [")[1].split("]")[0];
  assert.ok(connect.includes('"https://*.google-analytics.com"'));
  assert.ok(connect.includes('"https://*.analytics.google.com"'));
  assert.ok(!connect.includes('"https:"'));
});
