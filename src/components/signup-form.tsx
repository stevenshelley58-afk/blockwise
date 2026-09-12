"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import {
  hasTurnstileSiteKey,
  TurnstileVerification,
} from "@/components/auth/turnstile-verification";
import { SSOButtons } from "@/components/auth/sso-buttons";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { validateEmail } from "@/lib/auth/form-validation";
import { adRadarSignupMetadata } from "@/lib/research/ad-radar-signup";

export function SignupForm({ auditId }: { auditId?: string | null }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const nextPath = auditId ? `/self-serve?auditId=${encodeURIComponent(auditId)}` : "/self-serve";
  const confirmNext = encodeURIComponent(nextPath);
  // Keep the default confirm path byte-identical so plain signups behave exactly as before.
  const defaultConfirmPath = "/auth/confirm?next=/self-serve&flow=signup";
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  function resetTurnstile() {
    setTurnstileToken("");
    setTurnstileResetSignal((signal) => signal + 1);
  }

  async function submitMagicLink(email: string) {
    setIsSubmitting(true);

    const { error: signUpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        captchaToken: turnstileToken,
        emailRedirectTo: `${typeof window !== "undefined" ? window.location.origin : ""}${auditId ? `/auth/confirm?next=${confirmNext}&flow=signup` : defaultConfirmPath}`,
        shouldCreateUser: true,
        data: {
          signup_flow: "trial_self_serve",
          ...adRadarSignupMetadata(location.search),
        },
      },
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError("We could not send the secure link. Check your email and try again.");
      resetTurnstile();
      return;
    }

    setSubmittedEmail(email);
    setIsSubmitted(true);
  }

  async function submitPassword(email: string, password: string) {
    setIsSubmitting(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: turnstileToken,
        emailRedirectTo: `${typeof window !== "undefined" ? window.location.origin : ""}${auditId ? `/auth/confirm?next=${confirmNext}&flow=signup` : defaultConfirmPath}`,
        data: {
          signup_flow: "trial_self_serve",
          ...adRadarSignupMetadata(location.search),
        },
      },
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError(signUpError.message === "User already registered"
        ? "An account with this email already exists. Try signing in instead."
        : "We could not create your account. Check your details and try again.");
      resetTurnstile();
      return;
    }

    setSubmittedEmail(email);
    setIsSubmitted(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = mode === "password" ? String(formData.get("password") ?? "") : "";
    const companyWebsite = String(formData.get("company_website") ?? "");

    setError(null);

    if (companyWebsite) {
      setError("Unable to submit. Please try again.");
      return;
    }

    const emailError = validateEmail(email, "work email");
    if (emailError) {
      setError(emailError);
      return;
    }

    if (mode === "password" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (hasTurnstileSiteKey() && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    if (mode === "magic") {
      await submitMagicLink(email);
    } else {
      await submitPassword(email, password);
    }
  }

  if (isSubmitted) {
    return (
      <div className="signup-success" role="status" aria-live="polite">
        <strong>Check your email</strong>
        <p>
          We sent a confirmation to <strong>{submittedEmail}</strong>. Use it to verify
          your account and start creating ads.
        </p>
      </div>
    );
  }

  return (
    <>
      <SSOButtons mode="signup" />
      <div className="auth-divider">
        <span>or</span>
      </div>
      <form
        className="login-form signup-form"
        onSubmit={submit}
        noValidate
        data-clarity-mask="true"
        aria-describedby={`${error ? "signup-error " : ""}signup-consent`}
      >
        <div className="auth-mode-toggle">
          <button
            type="button"
            className={mode === "magic" ? "active" : ""}
            onClick={() => setMode("magic")}
          >
            Magic link
          </button>
          <button
            type="button"
            className={mode === "password" ? "active" : ""}
            onClick={() => setMode("password")}
          >
            Password
          </button>
        </div>

        <label htmlFor="signup-email">
          Work email
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={200}
          />
        </label>

        {mode === "password" ? (
          <label htmlFor="signup-password">
            Password
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
        ) : null}

        <div
          aria-hidden
          className="signup-honeypot"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          <label htmlFor="signup-company-website">Company website</label>
          <input
            id="signup-company-website"
            name="company_website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <p className="signup-consent" id="signup-consent">
          By continuing, you accept the <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>

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

        <Button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting ? <ButtonSpinner size={16} label={mode === "magic" ? "Sending secure link" : "Creating account"} /> : null}
          {isSubmitting
            ? mode === "magic"
              ? "Sending secure link…"
              : "Creating account…"
            : mode === "magic"
              ? "Continue with email"
              : "Create account"}
        </Button>
      </form>
    </>
  );
}
