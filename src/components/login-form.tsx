"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { DEV_TEST_PASSWORD, getRedirectForEmail, testUsers } from "@/lib/auth/test-users";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type LoginFormProps = {
  showTestProfiles?: boolean;
};

export function LoginForm({ showTestProfiles = false }: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string>(showTestProfiles ? testUsers[0].email : "");
  const [password, setPassword] = useState<string>(showTestProfiles ? DEV_TEST_PASSWORD : "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signIn(targetEmail: string = email, targetPassword: string = password) {
    setError(null);
    setIsSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password: targetPassword,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace(getRedirectForEmail(targetEmail));
    router.refresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn();
  }

  return (
    <div className="login-stack">
      {showTestProfiles ? (
        <div className="profile-grid">
          {testUsers.map((user) => (
            <button
              className="profile-button"
              type="button"
              key={user.email}
              onClick={() => {
                setEmail(user.email);
                setPassword(DEV_TEST_PASSWORD);
                void signIn(user.email, DEV_TEST_PASSWORD);
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
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
