"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import { hasTurnstileSiteKey, TurnstileVerification } from "@/components/auth/turnstile-verification";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ForgotPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (hasTurnstileSiteKey() && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    setIsSubmitting(true);

    const redirectTo = `${window.location.origin}/auth/confirm?next=/reset-password&flow=recovery`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
      captchaToken: turnstileToken,
    });

    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      setTurnstileToken("");
      setTurnstileResetSignal((signal) => signal + 1);
      return;
    }

    setSuccess(true);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="forgot-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <p className="eyebrow">Password reset</p>
          <h1 id="forgot-heading">Forgot your password?</h1>
          <p className="login-copy">Enter your email address and we&apos;ll send you a reset link.</p>
        </div>

        {success ? (
          <p className="form-success">Check your email for a password reset link.</p>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <TurnstileVerification
              resetSignal={turnstileResetSignal}
              onTokenChange={(token) => {
                setTurnstileToken(token);
                if (token) setError(null);
              }}
              onError={() => setError("Verification failed. Please try again.")}
            />
            {error ? <p className="form-error">{error}</p> : null}
            <button
              className="button"
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting || undefined}
            >
              {isSubmitting ? <ButtonSpinner size={16} label="Sending reset link" /> : null}
              {isSubmitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="auth-alt-link">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
