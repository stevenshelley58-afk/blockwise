import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signupFormPath = "src/components/signup-form.tsx";
const signupPagePath = "src/app/signup/page.tsx";
const confirmRoutePath = "src/app/auth/confirm/route.ts";
const loginPagePath = "src/app/login/page.tsx";
const loginFormPath = "src/components/login-form.tsx";
const forgotPasswordPagePath = "src/app/forgot-password/page.tsx";
const turnstileVerificationPath = "src/components/auth/turnstile-verification.tsx";

test("signup form uses Supabase captchaToken and trial metadata without a Turnstile dependency", () => {
  const source = readFileSync(signupFormPath, "utf8");
  const turnstile = readFileSync(turnstileVerificationPath, "utf8");

  assert.doesNotMatch(source, /@marsidev/i);
  assert.match(turnstile, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/i);
  assert.match(turnstile, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(source, /<TurnstileVerification/i);
  assert.match(source, /captchaToken:\s*turnstileToken/i);
  assert.match(source, /emailRedirectTo:\s*`\$\{location\.origin\}\/auth\/confirm\?next=\/self-serve\?confirmed=1`/i);
  assert.match(source, /signup_flow:\s*"trial_self_serve"/i);
  assert.match(source, /agency_name:\s*agencyName/i);
  assert.match(source, /name="company_website"/i);
  assert.match(source, /signup-honeypot/i);
  assert.match(source, /name="terms"/i);
  assert.doesNotMatch(source, /onboarding_status/i);
});

test("signup page redirects authenticated users and renders the signup form", () => {
  const source = readFileSync(signupPagePath, "utf8");

  assert.match(source, /supabase\.auth\.getUser\(\)/i);
  assert.match(source, /redirect\("\/home"\)/i);
  assert.match(source, /<SignupForm \/>/i);
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
  assert.match(source, /\/login\?error=confirm_failed/);
});

test("login page points new clients to signup", () => {
  const source = readFileSync(loginPagePath, "utf8");

  assert.match(source, /href="\/signup"/);
  assert.match(source, /Start free trial/i);
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
