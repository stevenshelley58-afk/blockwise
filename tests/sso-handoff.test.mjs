import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = await readFile(new URL("../src/components/auth/sso-buttons.tsx", import.meta.url), "utf8");
const compose = await readFile(new URL("../infra/coolify/docker-compose.product.yml", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

test("Google signs in with an ID token, not a redirect", () => {
  // The redirect flow needed a PKCE code verifier to survive a round trip
  // through Google, and it did not: the verifier was missing when the code came
  // back, so no session was ever created. The id_token grant has no redirect and
  // no browser-held verifier.
  assert.match(source, /signInWithIdToken\(/);
  assert.match(source, /provider: "google"/);
  assert.match(source, /token: credential/);
  assert.doesNotMatch(source, /provider: "google"[\s\S]{0,80}signInWithOAuth/);
});

test("Google's own button is rendered, and only with a client id", () => {
  // Google Identity Services must render its own button: the iframe is what
  // carries the consent and the credential callback.
  assert.match(source, /accounts\.google\.com\/gsi\/client/);
  assert.match(source, /renderButton\(/);
  assert.match(source, /NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
  // Without the client id nothing is drawn, rather than a button that cannot work.
  assert.match(source, /\{googleClientId \? <div className="sso-google" ref=\{googleSlot\} \/> : null\}/);
});

test("the public client id reaches the browser build", () => {
  // NEXT_PUBLIC_ values are inlined at build time, so the value must be present
  // as a build arg as well as in the runtime environment, and declared in the
  // Dockerfile, or the built bundle ships an empty client id.
  const dockerfile = readFileSync("infra/product/Dockerfile", "utf8");
  const wiring = compose.match(/NEXT_PUBLIC_GOOGLE_CLIENT_ID: \$\{BLOCKWISE_AUTH_GOOGLE_CLIENT_ID:-\}/g) ?? [];
  assert.equal(wiring.length, 2, "expected the build arg and the runtime environment");
  assert.match(dockerfile, /^ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=/m);
  assert.match(dockerfile, /^ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=\$NEXT_PUBLIC_GOOGLE_CLIENT_ID$/m);
});

test("the Content-Security-Policy allows the Google button", () => {
  // Without these the browser blocks the script and the button iframe: the
  // sign-in silently does nothing.
  const scriptSrc = nextConfig.match(/"script-src [^"]+"/)?.[0] ?? "";
  const frameSrc = nextConfig.match(/"frame-src [^"]+"/)?.[0] ?? "";
  const connectSrc = nextConfig.match(/"https:\/\/accounts\.google\.com",/)?.[0] ?? "";
  assert.match(scriptSrc, /https:\/\/accounts\.google\.com/);
  assert.match(frameSrc, /https:\/\/accounts\.google\.com/);
  assert.ok(connectSrc, "connect-src must allow accounts.google.com");
});

test("Microsoft keeps its redirect hand-off and its own mark", () => {
  // Azure has no id_token variant in this flow, so it keeps the redirect, which
  // returns to the route that exchanges the code.
  assert.match(source, /provider: "azure"/);
  assert.match(source, /\/auth\/confirm\?next=\/self-serve&flow=\$\{mode\}/);
  assert.match(source, /function MicrosoftMark\(\)/);
  assert.match(source, /className="sso-icon" viewBox="0 0 23 23"/);
  assert.doesNotMatch(source, /icon: "[A-Z]"/);
});

test("only one sign-in is in flight at a time", () => {
  assert.match(source, /const inFlight = useRef\(false\)/);
  assert.match(source, /if \(inFlight\.current\) return;/);
});
