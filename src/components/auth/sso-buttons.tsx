"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ButtonSpinner } from "@/components/app/button-spinner";

type SSOProvider = "google" | "azure";

/**
 * Official provider marks, inlined at their published brand colours so the
 * button is recognisable at a glance. Google's 48px "G" and Microsoft's
 * four-square logo; both keep their own aspect and are sized by `.sso-icon`.
 */
function GoogleMark() {
  return (
    <svg className="sso-icon" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
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

const PROVIDER_CONFIG: Record<SSOProvider, { label: string; mark: () => React.JSX.Element }> = {
  google: { label: "Google", mark: GoogleMark },
  azure: { label: "Microsoft", mark: MicrosoftMark },
};

export function SSOButtons({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loadingProvider, setLoadingProvider] = useState<SSOProvider | null>(null);

  async function signInWithOAuth(provider: SSOProvider) {
    setLoadingProvider(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${typeof window !== "undefined" ? window.location.origin : ""}/auth/confirm?next=/self-serve&flow=${mode}`,
      },
    });
    if (error) {
      setLoadingProvider(null);
      // Error is handled by the OAuth redirect flow failing
    }
  }

  const actionLabel = mode === "signup" ? "Sign up" : "Sign in";

  return (
    <div className="sso-grid">
      {(Object.keys(PROVIDER_CONFIG) as SSOProvider[]).map((provider) => {
        const config = PROVIDER_CONFIG[provider];
        const isLoading = loadingProvider === provider;
        const Mark = config.mark;
        return (
          <button
            key={provider}
            type="button"
            className="sso-button"
            onClick={() => void signInWithOAuth(provider)}
            disabled={isLoading || loadingProvider !== null}
            aria-busy={isLoading || undefined}
          >
            {isLoading ? <ButtonSpinner size={14} label={config.label} /> : <Mark />}
            <span>{actionLabel} with {config.label}</span>
          </button>
        );
      })}
    </div>
  );
}
