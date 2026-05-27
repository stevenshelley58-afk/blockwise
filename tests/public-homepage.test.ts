import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public homepage does not redirect anonymous visitors to the login screen", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");

  assert.doesNotMatch(source, /redirect\(/);
  assert.match(source, /Request access/);
  assert.match(source, /Client sign in/);
});

test("production login page does not expose development test profiles or passwords", () => {
  const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
  const loginForm = readFileSync("src/components/login-form.tsx", "utf8");

  assert.match(loginPage, /showTestProfiles=\{process\.env\.NODE_ENV !== "production"\}/);
  assert.match(loginForm, /showTestProfiles/);
  assert.doesNotMatch(loginPage, /SJS5858/);
  assert.doesNotMatch(loginPage, /Dev login/);
});
