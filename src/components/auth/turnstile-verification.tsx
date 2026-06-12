"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

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

type TurnstileVerificationProps = {
  onTokenChange(token: string): void;
  onError(): void;
  resetSignal?: number;
};

export function hasTurnstileSiteKey() {
  return Boolean(turnstileSiteKey);
}

export function TurnstileVerification({ onTokenChange, onError, resetSignal = 0 }: TurnstileVerificationProps) {
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const tokenChangeRef = useRef(onTokenChange);
  const errorRef = useRef(onError);

  useEffect(() => {
    tokenChangeRef.current = onTokenChange;
    errorRef.current = onError;
  }, [onTokenChange, onError]);

  function renderTurnstile() {
    if (!turnstileSiteKey || !turnstileRef.current || !window.turnstile || turnstileWidgetId.current) {
      return;
    }

    turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      callback(token: string) {
        tokenChangeRef.current(token);
      },
      "expired-callback"() {
        tokenChangeRef.current("");
      },
      "error-callback"() {
        tokenChangeRef.current("");
        errorRef.current();
      },
    });
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

  useEffect(() => {
    if (turnstileWidgetId.current) {
      window.turnstile?.reset(turnstileWidgetId.current);
    }
    tokenChangeRef.current("");
  }, [resetSignal]);

  if (!turnstileSiteKey) {
    return null;
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderTurnstile}
      />
      <div className="turnstile-box" ref={turnstileRef} />
    </>
  );
}
