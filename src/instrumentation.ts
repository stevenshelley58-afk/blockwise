import * as Sentry from "@sentry/nextjs";

import { redactValue } from "@/lib/redact";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      // Vercel is retired, so VERCEL_ENV is never set on the VPS and every
      // production error was filed under "development". NODE_ENV is the honest
      // source here; SENTRY_ENVIRONMENT overrides it for a preview or a staging box.
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      beforeSend(event) {
        return redactValue(event) as typeof event;
      },
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
