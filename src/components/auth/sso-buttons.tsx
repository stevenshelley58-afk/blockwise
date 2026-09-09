"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ButtonSpinner } from "@/components/app/button-spinner";

type SSOProvider = "google" | "azure";

const PROVIDER_CONFIG: Record<SSOProvider, { label: string; icon: string }> = {
  google: { label: "Google", icon: "G" },
  azure: { label: "Microsoft", icon: "M" },
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
        return (
          <button
            key={provider}
            type="button"
            className="sso-button"
            onClick={() => void signInWithOAuth(provider)}
            disabled={isLoading || loadingProvider !== null}
            aria-busy={isLoading || undefined}
          >
            {isLoading ? <ButtonSpinner size={14} label={config.label} /> : (
              <span className="sso-icon" aria-hidden>{config.icon}</span>
            )}
            <span>{actionLabel} with {config.label}</span>
          </button>
        );
      })}
    </div>
  );
}
