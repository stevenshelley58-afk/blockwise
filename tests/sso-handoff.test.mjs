import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/auth/sso-buttons.tsx", import.meta.url), "utf8");

test("the sign-in buttons hand off to the providers GoTrue has configured", () => {
  // Supabase provider keys, not display names: a wrong key sends the browser to
  // an authorize URL that answers 400 and the button appears to do nothing.
  const providerKeys = [...source.matchAll(/^\s{2}(\w+): \{ label: "([^"]+)", mark:/gmu)].map(([, key, label]) => [key, label]);
  assert.deepEqual(providerKeys, [
    ["google", "Google"],
    ["azure", "Microsoft"],
  ]);
});

test("the OAuth hand-off returns to the app's own confirm route", () => {
  // GoTrue validates the return against the allow list, and /auth/confirm is
  // what exchanges the code and bootstraps the workspace.
  assert.match(source, /\/auth\/confirm\?next=\/self-serve&flow=\$\{mode\}/);
  assert.match(source, /window\.location\.origin/);
});

test("each button carries the provider's own mark, not a letter tile", () => {
  assert.match(source, /function GoogleMark\(\)/);
  assert.match(source, /function MicrosoftMark\(\)/);
  assert.match(source, /className="sso-icon" viewBox="0 0 48 48"/);
  assert.match(source, /className="sso-icon" viewBox="0 0 23 23"/);
  assert.doesNotMatch(source, /icon: "[A-Z]"/);
});

test("a rejected hand-off releases the button for a retry", () => {
  assert.match(source, /catch \{[\s\S]*?setLoadingProvider\(null\)/);
});

test("only one hand-off is in flight at a time", () => {
  // A double click fires two authorize requests before React re-renders and
  // disables the button. The second overwrites the PKCE code verifier that the
  // first request's callback needs, so the exchange comes back with no session
  // and the customer lands signed out.
  assert.match(source, /const handoffInFlight = useRef\(false\)/);
  assert.match(source, /if \(handoffInFlight\.current\) return;/);
  assert.match(source, /handoffInFlight\.current = false;[\s\S]*?setLoadingProvider\(null\)/);
});
