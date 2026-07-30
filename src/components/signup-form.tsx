"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import {
  hasTurnstileSiteKey,
  TurnstileVerification,
} from "@/components/auth/turnstile-verification";
import type { BillingMarket, BillingProduct } from "@/lib/billing/offers";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignupForm({
  requestedOffer,
  requestedMarket,
}: {
  requestedOffer?: BillingProduct | null;
  requestedMarket?: BillingMarket | null;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const companyWebsite = String(formData.get("company_website") ?? "");

    setError(null);

    if (companyWebsite) {
      setError("Unable to send that sign-in link.");
      return;
    }

    if (!email) {
      setError("Enter your work email.");
      return;
    }

    if (hasTurnstileSiteKey() && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    setIsSubmitting(true);
    const nextParams = new URLSearchParams();
    if (requestedOffer) nextParams.set("offer", requestedOffer.replace("_", "-"));
    if (requestedMarket) nextParams.set("market", requestedMarket.toLowerCase());
    const serializedNextParams = nextParams.toString();
    const nextPath = `/self-serve${serializedNextParams ? `?${serializedNextParams}` : ""}`;
    const confirmUrl = new URL("/auth/confirm", location.origin);
    confirmUrl.searchParams.set("next", nextPath);

    const { error: signUpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        captchaToken: turnstileToken,
        emailRedirectTo: confirmUrl.toString(),
        shouldCreateUser: true,
        data: {
          signup_flow: requestedOffer === "managed" ? "managed" : "trial_self_serve",
          requested_offer: requestedOffer ?? "self_serve",
          requested_market: requestedMarket ?? null,
        },
      },
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError("We couldn't send the secure link. Check your email and try again.");
      resetTurnstile();
      return;
    }

    setSubmittedEmail(email);
    setIsSubmitted(true);
  }

  if (isSubmitted) {
    return (
      <div className="signup-success" role="status" aria-live="polite">
        <strong>Check your email</strong>
        <p>
          We sent a secure sign-in link to <strong>{submittedEmail}</strong>. Use it to create or
          resume your workspace.
        </p>
      </div>
    );
  }

  return (
    <form
      className="login-form signup-form"
      onSubmit={submit}
      noValidate
      aria-describedby={`${error ? "signup-error " : ""}signup-consent`}
    >
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

      <button
        className="button"
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting || undefined}
      >
        {isSubmitting ? <ButtonSpinner size={16} label="Sending secure link" /> : null}
        {isSubmitting ? "Sending secure link…" : "Continue with email"}
      </button>
    </form>
  );
}
