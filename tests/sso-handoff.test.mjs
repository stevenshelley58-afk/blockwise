import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";

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

test("the Content-Security-Policy allows the whole Google Identity Services surface", () => {
  // Google's setup guide asks for the GIS parent URL in connect-src and
  // frame-src rather than individual endpoints, so a GIS update cannot break
  // the policy, plus the stylesheet in style-src and the client in script-src.
  const scriptSrc = nextConfig.match(/"script-src [^"]+"/)?.[0] ?? "";
  const styleSrc = nextConfig.match(/"style-src [^"]+"/)?.[0] ?? "";
  const frameSrc = nextConfig.match(/"frame-src [^"]+"/)?.[0] ?? "";
  const connectSrc = nextConfig.match(/^\s+"https:\/\/accounts\.google\.com\/gsi\/",$/m)?.[0] ?? "";
  assert.match(scriptSrc, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(styleSrc, /https:\/\/accounts\.google\.com\/gsi\/style/);
  assert.match(frameSrc, /https:\/\/accounts\.google\.com\/gsi\//);
  assert.ok(connectSrc, "connect-src must allow the Google Identity Services parent URL");
});

test("the popup Google opens is not severed by the opener policy", () => {
  // Google's setup guide: with FedCM disabled the popup needs
  // same-origin-allow-popups, and plain same-origin breaks window
  // communication ("a blank pop-up window or similar bugs"). The public edge
  // injects same-origin, so the app has to state its own.
  assert.match(nextConfig, /"Cross-Origin-Opener-Policy", value: "same-origin-allow-popups"/);
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


test("Microsoft requests the email scope GoTrue needs for account creation", () => {
  assert.match(source, /provider: "azure",\s+options: {\s+scopes: "email"/);
});

test("Microsoft credentials are server-only and opt-in", () => {
  for (const [key, value] of [
    ["ENABLED", "BLOCKWISE_AUTH_AZURE_ENABLED:-false"],
    ["CLIENT_ID", "BLOCKWISE_AUTH_AZURE_CLIENT_ID:-"],
    ["SECRET", "BLOCKWISE_AUTH_AZURE_CLIENT_SECRET:-"],
    ["URL", "BLOCKWISE_AUTH_AZURE_URL:-https://login.microsoftonline.com/common"],
  ]) assert.ok(compose.includes(`GOTRUE_EXTERNAL_AZURE_${key}: \${${value}}`));
  assert.ok(compose.includes("GOTRUE_EXTERNAL_AZURE_REDIRECT_URI:"));
  assert.doesNotMatch(source, /AZURE_CLIENT_SECRET|GOTRUE_EXTERNAL_AZURE_SECRET/);
});

test("Auth activation is separately gated and restricted to the live committed release", async () => {
  const helper = await readFile(new URL("../scripts/vps/product-auth-release.sh", import.meta.url), "utf8");
  assert.match(helper, /product-release-preflight.sh" "\$target" --check-live/);
  assert.match(helper, /flock -x 9/);
  assert.match(helper, /Non-Microsoft Auth setting changed/);
  assert.match(helper, /Auth image changed/);
  assert.match(helper, /trap rollback ERR/);
  assert.match(helper, /--no-deps --no-build --pull never --force-recreate product-auth/);
  assert.doesNotMatch(helper, /force-recreate product-app/);
});

test("Auth guard preserves inherited image defaults but rejects removed overrides", async () => {
  const helper = await readFile(new URL("../scripts/vps/product-auth-release.sh", import.meta.url), "utf8");
  const guard = helper.split("current=json.loads")[1].split("if desired.get")[0];
  const script = `
import json, sys
container='auth'
candidate={'image':'auth:fixed', 'environment':{'GOTRUE_EXTERNAL_AZURE_ENABLED':'true'}}
current={'Image':'sha256:same','Config':{'Image':'auth:fixed','Env':['GOTRUE_DB_MIGRATIONS_PATH='+sys.argv[1]]}}
image={'Id':sys.argv[2], 'Config':{'Env':['GOTRUE_DB_MIGRATIONS_PATH=/migrations']}}
def run(args): return json.dumps([image] if args[1]=='image' else [current])
current=json.loads${guard}
`;
  for (const [value, image, expected] of [
    ["/migrations", "sha256:same", 0],
    ["/custom", "sha256:same", 1],
    ["/migrations", "sha256:changed", 1],
  ]) {
    const result = spawnSync("python3", ["-c", script, value, image], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
  }
});
