import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signupFormPath = "src/components/signup-form.tsx";
const signupPagePath = "src/app/signup/page.tsx";
const confirmRoutePath = "src/app/auth/confirm/route.ts";
const loginPagePath = "src/app/login/page.tsx";
const loginFormPath = "src/components/login-form.tsx";
const forgotPasswordPagePath = "src/app/forgot-password/page.tsx";
const resetPasswordPagePath = "src/app/reset-password/page.tsx";
const pageGuardsPath = "src/lib/auth/page-guards.ts";
const accessUnavailablePagePath = "src/app/access-unavailable/page.tsx";
const accessUnavailableActionsPath = "src/app/access-unavailable/access-unavailable-actions.tsx";
const turnstileVerificationPath = "src/components/auth/turnstile-verification.tsx";

test("signup starts or resumes an account with one passwordless email field", () => {
  const source = readFileSync(signupFormPath, "utf8");
  const turnstile = readFileSync(turnstileVerificationPath, "utf8");

  assert.doesNotMatch(source, /@marsidev/i);
  assert.match(turnstile, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/i);
  assert.match(turnstile, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.doesNotMatch(turnstile, /turnstile\.ready/);
  assert.match(turnstile, /onReady=\{renderTurnstile\}/);
  assert.match(turnstile, /appearance:\s*"always"/);
  assert.match(turnstile, /execution:\s*"render"/);
  assert.match(source, /<TurnstileVerification/i);
  assert.match(source, /captchaToken:\s*turnstileToken/i);
  assert.match(source, /signInWithOtp\(\{/i);
  assert.match(source, /shouldCreateUser:\s*true/i);
  assert.match(source, /confirmUrl\.searchParams\.set\("next", nextPath\)/i);
  assert.match(source, /emailRedirectTo:\s*confirmUrl\.toString\(\)/i);
  assert.match(source, /requestedOffer === "managed" \? "managed" : "trial_self_serve"/i);
  assert.match(source, /requested_offer:\s*requestedOffer \?\? "self_serve"/i);
  assert.match(source, /requested_market:\s*requestedMarket \?\? null/i);
  assert.match(source, /name="company_website"/i);
  assert.match(source, /signup-honeypot/i);
  assert.match(source, /By continuing, you accept the/i);
  assert.match(source, /href="\/terms"/i);
  assert.match(source, /href="\/privacy"/i);
  assert.doesNotMatch(source, /type="password"/i);
  assert.doesNotMatch(source, /name="agency_name"/i);
  assert.doesNotMatch(source, /name="terms"/i);
  assert.doesNotMatch(source, /signUp\(\{/i);
  assert.doesNotMatch(source, /onboarding_status/i);
});

test("signup page redirects authenticated users and renders the signup form", () => {
  const source = readFileSync(signupPagePath, "utf8");

  assert.match(source, /supabase\.auth\.getUser\(\)/i);
  assert.match(source, /redirect\("\/home"\)/i);
  assert.match(source, /<SignupForm requestedOffer=\{offer\} requestedMarket=\{market\} \/>/i);
  assert.match(source, /Start managed onboarding/i);
  assert.match(source, /summarizeOffer\(offer, market\)/i);
  assert.match(source, /formatBillingAmount/i);
});

test("confirm route verifies token hash and only redirects to safe relative next paths", () => {
  const source = readFileSync(confirmRoutePath, "utf8");

  assert.match(source, /token_hash/);
  assert.match(source, /searchParams\.get\("type"\)/);
  assert.match(source, /searchParams\.get\("next"\)/);
  assert.match(source, /verifyOtp\(\{/);
  assert.match(source, /function sanitizeNextPath/i);
  assert.match(source, /const DEFAULT_NEXT_PATH = "\/self-serve"/);
  assert.match(source, /new URL\(redirectPath,\s*requestUrl\.origin\)/);
  assert.match(source, /startsWith\("\/\/"\)/);
  assert.match(source, /includes\("\\\\"\)/);
  assert.match(source, /parsed\.origin !== SAFE_REDIRECT_ORIGIN/i);
  assert.match(source, /type: type as EmailOtpType/i);
  assert.match(source, /supabase\.auth\.getUser\(\)/i);
  assert.match(source, /acceptVerifiedWorkspaceInvitations\(\{\s*user\s*\}\)/i);
  assert.match(
    source,
    /bootstrapVerifiedTrialWorkspace\(\{\s*user,\s*serviceSupabase:\s*service\s*\}\)/i,
  );
  assert.ok(
    source.indexOf("acceptVerifiedWorkspaceInvitations({ user })")
      < source.indexOf("bootstrapVerifiedTrialWorkspace({ user, serviceSupabase: service })"),
  );
  assert.match(source, /workspace_bootstrap_failed/i);
  assert.match(source, /\/login\?error=confirm_failed/);
});

test("login page points new clients to signup", () => {
  const source = readFileSync(loginPagePath, "utf8");

  assert.match(source, /searchParams/);
  assert.match(source, /error === "confirm_failed"/);
  assert.match(source, /That confirmation link is invalid or expired/);
  assert.match(source, /href="\/signup"/);
  assert.match(source, /Create three ads free/i);
});

test("login form keeps email validation while identifying the account field to password managers", () => {
  const source = readFileSync(loginFormPath, "utf8");

  assert.match(source, /id="login-email"[\s\S]{0,200}type="email"[\s\S]{0,300}autoComplete="username"/i);
  assert.match(source, /id="login-password"[\s\S]*type="password"[\s\S]*autoComplete="current-password"/i);
  assert.match(source, /signInWithPassword\(\{/i);
});

test("login and password reset pass Turnstile captcha tokens to Supabase auth", () => {
  const loginForm = readFileSync(loginFormPath, "utf8");
  const forgotPassword = readFileSync(forgotPasswordPagePath, "utf8");

  assert.match(loginForm, /<TurnstileVerification/i);
  assert.match(loginForm, /hasTurnstileSiteKey\(\) && !turnstileToken/);
  assert.match(loginForm, /signInWithPassword\(\{[\s\S]*options:\s*\{[\s\S]*captchaToken:\s*turnstileToken/i);
  assert.match(loginForm, /setTurnstileResetSignal\(\(signal\) => signal \+ 1\)/);

  assert.match(forgotPassword, /<TurnstileVerification/i);
  assert.match(forgotPassword, /hasTurnstileSiteKey\(\) && !turnstileToken/);
  assert.match(forgotPassword, /resetPasswordForEmail\(email,\s*\{[\s\S]*captchaToken:\s*turnstileToken/i);
  assert.match(forgotPassword, /setTurnstileResetSignal\(\(signal\) => signal \+ 1\)/);
});

test("reset and denied access flows avoid dead-end redirects", () => {
  const resetPassword = readFileSync(resetPasswordPagePath, "utf8");
  const pageGuards = readFileSync(pageGuardsPath, "utf8");
  const accessPage = readFileSync(accessUnavailablePagePath, "utf8");
  const accessActions = readFileSync(accessUnavailableActionsPath, "utf8");

  assert.match(resetPassword, /setIsUpdated\(true\)/);
  assert.match(resetPassword, /Password updated/);
  assert.match(resetPassword, /30000/);
  assert.doesNotMatch(resetPassword, /router\.replace\("\/login"\)/);

  assert.match(pageGuards, /\/access-unavailable\?reason=/);
  assert.doesNotMatch(pageGuards, /\/results\?error=access_denied/);
  assert.match(accessPage, /No workspace found/);
  assert.match(accessActions, /supabase\.auth\.signOut\(\)/);
  assert.match(accessActions, /router\.replace\(target === "signup" \? "\/signup" : "\/login"\)/);
});
