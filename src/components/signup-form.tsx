"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type TurnstileOptions = {
  sitekey: string;
  callback(token: string): void;
  "expired-callback"(): void;
  "error-callback"(): void;
};

type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function cleanAgencyName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function SignupForm() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  function renderTurnstile() {
    if (!turnstileSiteKey || !turnstileRef.current || !window.turnstile || turnstileWidgetId.current) {
      return;
    }

    turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      callback(token: string) {
        setTurnstileToken(token);
        setError(null);
      },
      "expired-callback"() {
        setTurnstileToken("");
      },
      "error-callback"() {
        setTurnstileToken("");
        setError("Verification failed. Please try again.");
      },
    });
  }

  function resetTurnstile() {
    if (turnstileWidgetId.current) {
      window.turnstile?.reset(turnstileWidgetId.current);
    }
    setTurnstileToken("");
  }

  useEffect(() => {
    renderTurnstile();

    return () => {
      if (turnstileWidgetId.current) {
        window.turnstile?.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, []);

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

    if (turnstileSiteKey && !turnstileToken) {
      setError("Complete the verification check.");
      return;
    }

    setIsSubmitting(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: turnstileToken,
        emailRedirectTo: `${location.origin}/auth/confirm?next=/start`,
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
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderTurnstile}
      />
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
          />
        </label>
        <label htmlFor="signup-agency-name">
          Agency name
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

        <div className="turnstile-box" ref={turnstileRef} />

        {error ? (
          <p className="form-error" id="signup-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account" : "Create free trial account"}
        </button>
      </form>
    </>
  );
}
