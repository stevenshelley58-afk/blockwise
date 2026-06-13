"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import { hasTurnstileSiteKey, TurnstileVerification } from "@/components/auth/turnstile-verification";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function cleanAgencyName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function SignupForm() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  function resetTurnstile() {
    setTurnstileToken("");
    setTurnstileResetSignal((signal) => signal + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const agencyName = cleanAgencyName(String(formData.get("agency_name") ?? ""));
    const companyWebsite = String(formData.get("company_website") ?? "");
    const acceptedTerms = formData.get("terms") === "on";

    setError(null);

    if (companyWebsite) {
      setError("Unable to create that account.");
      return;
    }

    if (!acceptedTerms) {
      setError("Accept the terms to start your trial.");
      return;
    }

    if (!agencyName) {
      setError("Enter your agency name.");
      return;
    }

    if (hasTurnstileSiteKey() && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    setIsSubmitting(true);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: turnstileToken,
        emailRedirectTo: `${location.origin}/auth/confirm?next=/self-serve?confirmed=1`,
        data: {
          signup_flow: "trial_self_serve",
          agency_name: agencyName,
        },
      },
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError(signUpError.message);
      resetTurnstile();
      return;
    }

    if (signUpData.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      setError("An account with this email already exists. Sign in or reset your password.");
      resetTurnstile();
      return;
    }

    setIsSubmitted(true);
  }

  if (isSubmitted) {
    return (
      <div className="signup-success" role="status" aria-live="polite">
        <strong>Check your email</strong>
        <p>Confirm your account to open your trial workspace.</p>
      </div>
    );
  }

  return (
    <>
      <form className="login-form signup-form" onSubmit={submit} noValidate aria-describedby={error ? "signup-error" : undefined}>
        <label htmlFor="signup-email">
          Work email
          <input id="signup-email" name="email" type="email" autoComplete="email" required maxLength={200} />
        </label>
        <label htmlFor="signup-password">
          Password
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={200}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <span
            className={`item-meta password-hint ${password.length >= 8 ? "is-ok" : ""}`}
            aria-live="polite"
          >
            {password.length === 0
              ? "At least 8 characters."
              : password.length >= 8
                ? "Strong enough — 8+ characters."
                : `${8 - password.length} more character${8 - password.length === 1 ? "" : "s"} to go.`}
          </span>
        </label>
        <label htmlFor="signup-agency-name">
          Business name
          <input id="signup-agency-name" name="agency_name" type="text" autoComplete="organization" required maxLength={160} />
        </label>

        <div
          aria-hidden
          className="signup-honeypot"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}
        >
          <label htmlFor="signup-company-website">Company website</label>
          <input id="signup-company-website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="signup-terms" htmlFor="signup-terms">
          <input id="signup-terms" name="terms" type="checkbox" required />
          <span>
            I agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>, and understand
            the trial includes 10 free ad packs.
          </span>
        </label>

        <TurnstileVerification
          resetSignal={turnstileResetSignal}
          onTokenChange={(token) => {
            setTurnstileToken(token);
            if (token) setError(null);
          }}
          onError={() => setError("Verification failed. Please try again.")}
        />

        {error ? (
          <p className="form-error" id="signup-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="button"
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting ? <ButtonSpinner size={16} label="Creating account" /> : null}
          {isSubmitting ? "Creating account…" : "Create free trial account"}
        </button>
      </form>
    </>
  );
}
