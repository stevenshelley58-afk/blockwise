import * as Sentry from "@sentry/nextjs";
import { redactValue } from "@/lib/redact";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // See instrumentation.ts: the retired Vercel variable left production events
  // labelled "development". NEXT_PUBLIC_SENTRY_ENVIRONMENT is the override that
  // survives the client build.
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  replaysOnErrorSampleRate: 1.0,
  integrations: [],
  beforeSend(event) {
    return redactValue(event) as typeof event;
  },
});
