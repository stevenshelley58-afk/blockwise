"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ButtonSpinner } from "@/components/app/button-spinner";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Provider sign-in.
 *
 * Google uses Google Identity Services and posts the ID token straight to
 * GoTrue (`signInWithIdToken`). The redirect flow it replaces depended on a PKCE
 * code verifier surviving a full round trip through Google, which failed on the
 * live site: the verifier was missing when the code came back, so no session was
 * ever created. This path has no redirect and no browser-held verifier, so that
 * failure cannot recur.
 *
 * Microsoft keeps the redirect hand-off, which is the only flow GoTrue exposes
 * for it.
 */

type SSOProvider = "google" | "azure";

const GOOGLE_SCRIPT_ID = "blockwise-google-identity";
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** Minimal shape of the Google Identity Services client this app uses. */
type GoogleAccountsId = {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      shape: "pill";
      text: "signin_with" | "signup_with";
      logo_alignment: "left";
      locale: string;
      width: number;
    },
  ): void;
};

function googleIdentity(): GoogleAccountsId | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { google?: { accounts?: { id?: GoogleAccountsId } } }).google;
  return candidate?.accounts?.id ?? null;
}

function MicrosoftMark() {
  return (
    <svg className="sso-icon" viewBox="0 0 23 23" aria-hidden focusable="false">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function SSOButtons({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loadingProvider, setLoadingProvider] = useState<SSOProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the disabled attribute: a double click lands a second request
  // before React re-renders, and only one sign-in should ever be in flight.
  const inFlight = useRef(false);
  const googleSlot = useRef<HTMLDivElement | null>(null);
  const googleReady = useRef(false);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  const actionLabel = mode === "signup" ? "Sign up" : "Sign in";

  const finishSignIn = useCallback(() => {
    // A full document load, not a router push: the session cookie has just been
    // written and every server component needs to read it.
    window.location.assign("/self-serve");
  }, []);

  const handleGoogleCredential = useCallback(
    async (credential: string | undefined) => {
      if (!credential) {
        setError("Google did not return a sign-in token. Please try again.");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credential,
      });
      if (signInError) {
        setError(`${signInError.message} Use your email and password, or try again.`);
        return;
      }
      finishSignIn();
    },
    [supabase, finishSignIn],
  );

  // Render Google's own button once its script is available. The button is an
  // iframe Google owns, so it is mounted imperatively rather than rendered.
  useEffect(() => {
    if (!googleClientId) return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;

    const draw = () => {
      const gsi = googleIdentity();
      const slot = googleSlot.current;
      if (cancelled || !gsi || !slot || googleReady.current) return false;

      gsi.initialize({
        client_id: googleClientId,
        callback: (response) => void handleGoogleCredential(response.credential),
      });

      const drawButton = () => {
        const width = Math.max(240, Math.min(400, Math.round(slot.getBoundingClientRect().width)));
        slot.replaceChildren();
        gsi.renderButton(slot, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: mode === "signup" ? "signup_with" : "signin_with",
          logo_alignment: "left",
          locale: "en_AU",
          width,
        });
      };

      googleReady.current = true;
      drawButton();
      observer = new ResizeObserver(drawButton);
      observer.observe(slot);
      return true;
    };

    if (draw()) {
      return () => {
        cancelled = true;
        observer?.disconnect();
      };
    }

    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.id = GOOGLE_SCRIPT_ID;
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const onLoad = () => {
      draw();
    };
    script.addEventListener("load", onLoad);

    return () => {
      cancelled = true;
      script.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [googleClientId, handleGoogleCredential, mode]);

  async function signInWithMicrosoft() {
    if (inFlight.current) return;
    inFlight.current = true;

    setError(null);
    setLoadingProvider("azure");
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: `${window.location.origin}/auth/confirm?next=/self-serve&flow=${mode}`,
        },
      });
      if (!oauthError) return;
    } catch {
      // A blocked or failed navigation throws instead of returning an error.
    }
    inFlight.current = false;
    setLoadingProvider(null);
    setError("Microsoft sign-in is unavailable right now. Use your email and password, or try again.");
  }

  return (
    <div className="sso-stack">
      <div className="sso-grid">
        {googleClientId ? <div className="sso-google" ref={googleSlot} /> : null}
        <button
          type="button"
          className="sso-button"
          onClick={() => void signInWithMicrosoft()}
          disabled={loadingProvider !== null}
          aria-busy={loadingProvider === "azure" || undefined}
        >
          {loadingProvider === "azure" ? <ButtonSpinner size={14} label="Microsoft" /> : <MicrosoftMark />}
          <span>{actionLabel} with Microsoft</span>
        </button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
