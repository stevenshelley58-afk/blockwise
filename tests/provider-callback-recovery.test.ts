import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { providerCallbackRecovery } from "../src/lib/auth/provider-callback-recovery.ts";

test("a provider code stranded on the marketing page is sent to the confirm route", () => {
  // The exact shape measured in production: Google returns, GoTrue's success
  // path puts the browser on the site root with the auth code.
  const target = providerCallbackRecovery("code=abc123&next=/self-serve");
  assert.ok(target, "expected a recovery target");
  const url = new URL(target, "https://blockwise.sale");
  assert.equal(url.pathname, "/auth/confirm");
  assert.equal(url.searchParams.get("code"), "abc123");
  // next survives, so the confirm route still knows where to send the customer.
  assert.equal(url.searchParams.get("next"), "/self-serve");
});

test("a provider error stranded on the marketing page keeps its detail", () => {
  const target = providerCallbackRecovery(
    "error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange&flow=signin&next=/self-serve",
  );
  assert.ok(target);
  const url = new URL(target, "https://blockwise.sale");
  assert.equal(url.pathname, "/auth/confirm");
  assert.equal(url.searchParams.get("error"), "server_error");
  assert.equal(url.searchParams.get("error_code"), "unexpected_failure");
  assert.equal(url.searchParams.get("flow"), "signin");
});

test("ordinary marketing queries are left alone", () => {
  for (const search of ["", "utm_source=facebook&utm_campaign=leads", "ref=guide", "auditId=abc"]) {
    assert.equal(providerCallbackRecovery(search), null, `unexpected recovery for ${search}`);
  }
});

test("the sign-in page's own error is not treated as a callback", () => {
  // /login?error=confirm_failed is how this app shows its own failure message.
  // Recovering on it would redirect the page to itself, forever.
  assert.equal(providerCallbackRecovery("error=confirm_failed&flow=oauth"), null);
  assert.equal(providerCallbackRecovery("error=confirm_failed"), null);
});

test("something is always carried, so the redirect cannot loop on an empty query", () => {
  for (const search of ["code=x", "error=server_error", "error_code=anything", "error_description=why"]) {
    const target = providerCallbackRecovery(search);
    assert.ok(target && new URLSearchParams(target.split("?")[1]).size > 0, `empty recovery for ${search}`);
  }
});

test("the request proxy recovers a callback before any page renders", async () => {
  // The recovery lives in the proxy, not in a page: the homepage contract
  // forbids redirecting from src/app/page.tsx, and this must also beat the
  // session work rather than run after a page has already rendered.
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /providerCallbackRecovery\(request\.nextUrl\.search/);
  assert.match(proxy, /return NextResponse\.redirect\(url\)/);
  assert.ok(
    proxy.indexOf("providerCallbackRecovery(request.nextUrl.search") < proxy.indexOf("await refreshSupabaseSession(request)"),
    "recovery must run before the session refresh",
  );

  const home = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /redirect\(/, "the marketing page must not redirect");
});
