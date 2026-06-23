"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import { hasTurnstileSiteKey, TurnstileVerification } from "@/components/auth/turnstile-verification";
import { testUsers } from "@/lib/auth/test-users";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type LoginFormProps = {
  offlineAuthDisabledReason?: string | null;
  offlineAuthEnabled?: boolean;
  showTestProfiles?: boolean;
  testProfilePassword?: string;
};

export function LoginForm({
  offlineAuthDisabledReason = null,
  offlineAuthEnabled = false,
  showTestProfiles = false,
  testProfilePassword = "",
}: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => (offlineAuthEnabled ? null : createSupabaseBrowserClient()), [offlineAuthEnabled]);
  const [email, setEmail] = useState<string>(offlineAuthEnabled ? "steven@blockwise.sale" : showTestProfiles ? testUsers[0].email : "");
  const [password, setPassword] = useState<string>(showTestProfiles ? testProfilePassword : "");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signIn(targetEmail: string = email, targetPassword: string = password) {
    setError(null);

    if (offlineAuthEnabled) {
      if (!targetPassword) {
        setError("Enter the offline login password.");
        return;
      }

      setIsSubmitting(true);
      const response = await fetch("/api/auth/offline-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: targetPassword }),
      }).catch(() => null);
      setIsSubmitting(false);

      if (!response?.ok) {
        const body = (await response?.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Offline login failed.");
        return;
      }

      router.replace("/home");
      router.refresh();
      return;
    }

    if (hasTurnstileSiteKey() && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    setIsSubmitting(true);

    if (!supabase) {
      setError("Supabase login is unavailable.");
      setIsSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password: targetPassword,
      options: {
        captchaToken: turnstileToken,
      },
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      setTurnstileToken("");
      setTurnstileResetSignal((signal) => signal + 1);
      return;
    }

    router.replace("/home");
    router.refresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn();
  }

  return (
    <div className="login-stack">
      {showTestProfiles && testProfilePassword ? (
        <div className="profile-grid">
          {testUsers.map((user) => (
            <button
              className="profile-button"
              type="button"
              key={user.email}
              onClick={() => {
                setEmail(user.email);
                setPassword(testProfilePassword);
                void signIn(user.email, testProfilePassword);
              }}
              disabled={isSubmitting}
            >
              <strong>{user.label}</strong>
              <span>{user.email}</span>
            </button>
          ))}
        </div>
      ) : null}

      <form className="login-form" onSubmit={submit}>
        <label htmlFor="login-email">
          Email
          <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <label htmlFor="login-password">
          Password
          <input
            id="login-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {offlineAuthDisabledReason ? <p className="form-error">{offlineAuthDisabledReason}</p> : null}
        <p style={{ margin: "4px 0 0", fontSize: "0.875rem", textAlign: "right" }}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
        {offlineAuthEnabled ? null : (
          <TurnstileVerification
            resetSignal={turnstileResetSignal}
            onTokenChange={(token) => {
              setTurnstileToken(token);
              if (token) setError(null);
            }}
            onError={() => setError("Verification failed. Please try again.")}
          />
        )}
        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="button"
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting ? <ButtonSpinner size={16} label="Signing in" /> : null}
          {isSubmitting ? "Signing in..." : offlineAuthEnabled ? "Offline sign in" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
