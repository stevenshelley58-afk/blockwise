"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isUpdated, setIsUpdated] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsReady(true);
      }
    });

    const timer = setTimeout(() => {
      setExpired(true);
    }, 30000);

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!userError && data.user) setIsReady(true);
    });

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setIsUpdated(true);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="reset-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <p className="eyebrow">Password reset</p>
          <h1 id="reset-heading">Set a new password</h1>
          <p className="login-copy">Choose a new password for your account.</p>
        </div>

        {isUpdated ? (
          <div className="signup-success" role="status" aria-live="polite">
            <strong>Password updated</strong>
            <p>You can now sign in with your new password.</p>
            <a className="button" href="/login">Sign in</a>
          </div>
        ) : !isReady && expired ? (
          <p className="login-copy">
            This reset link has expired or was already used.{" "}
            <a href="/forgot-password">Request a new one</a>.
          </p>
        ) : !isReady ? (
          <p className="login-copy">Verifying your reset link&hellip;</p>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Updating" : "Update password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
