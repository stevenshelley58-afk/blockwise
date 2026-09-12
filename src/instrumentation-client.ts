import { redactValue } from "@/lib/redact";

/*
 * The Sentry browser SDK is large (measured 425 KB raw / 132 KB Brotli) and it
 * was bundled into every route, because this module is part of the client
 * instrumentation entry. NEXT_PUBLIC_SENTRY_DSN is empty in production, so
 * Sentry.init was a no-op and that weight bought nothing.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so guarding the import on the
 * DSN lets the bundler drop the SDK entirely when no DSN is configured, and load
 * it on demand when one is. Nothing else changes: set a DSN and tracing,
 * redaction and error capture behave exactly as before.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
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
  });
}
