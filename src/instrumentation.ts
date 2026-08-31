import * as Sentry from "@sentry/nextjs";

import { redactValue } from "@/lib/redact";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? "development",
      beforeSend(event) {
        return redactValue(event) as typeof event;
      },
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
