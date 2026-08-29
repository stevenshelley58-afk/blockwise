"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import { hasTurnstileSiteKey, TurnstileVerification } from "@/components/auth/turnstile-verification";
import { testUsers } from "@/lib/auth/test-users";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type LoginFormProps = {
  showTestProfiles?: boolean;
  testProfilePassword?: string;
};

export function LoginForm({ showTestProfiles = false, testProfilePassword = "" }: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string>(showTestProfiles ? testUsers[0].email : "");
  const [password, setPassword] = useState<string>(showTestProfiles ? testProfilePassword : "");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signIn(targetEmail: string = email, targetPassword: string = password) {
    setError(null);

    if (hasTurnstileSiteKey() && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    setIsSubmitting(true);

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
          <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
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
        <p style={{ margin: "4px 0 0", fontSize: "0.875rem", textAlign: "right" }}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
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
          {isSubmitting ? <ButtonSpinner size={16} label="Signing in" /> : null}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
