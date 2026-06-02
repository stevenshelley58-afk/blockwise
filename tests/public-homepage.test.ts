import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public homepage does not redirect anonymous visitors to the login screen", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  // C5 fix: "Client sign in" text lives in SignInLink component so Space-key
  // activations scroll the page rather than navigating to /login.
  const signInLink = readFileSync("src/components/landing/sign-in-link.tsx", "utf8");

  assert.doesNotMatch(source, /redirect\(/);
  assert.match(source, /Request access/);
  // The sign-in link text is in its own component to prevent Space-key navigation.
  assert.match(signInLink, /Client sign in/);
  // The component is referenced from the page.
  assert.match(source, /SignInLink/);
});

test("production login page does not expose development test profiles or passwords", () => {
  const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
  const loginForm = readFileSync("src/components/login-form.tsx", "utf8");

  assert.match(loginPage, /showTestProfiles=\{process\.env\.NODE_ENV !== "production"\}/);
  assert.match(loginForm, /showTestProfiles/);
  assert.doesNotMatch(loginPage, /SJS5858/);
  assert.doesNotMatch(loginForm, /SJS5858/);
  assert.doesNotMatch(loginPage, /Dev login/);
});

test("test user seeding requires an explicit non-default password", () => {
  const seedScript = readFileSync("scripts/seed-test-users.mjs", "utf8");

  assert.match(seedScript, /BLOCKWISE_DEV_PASSWORD/);
  assert.match(seedScript, /password\.length < 16/);
  assert.doesNotMatch(seedScript, /SJS5858/);
});
