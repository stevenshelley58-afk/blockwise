import * as Sentry from "@sentry/nextjs";

let initialized = false;

export function initTriggerSentry() {
  if (initialized) return;
  initialized = true;

  Sentry.init({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.TRIGGER_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}

export function captureTriggerException(error: unknown, task?: string) {
  initTriggerSentry();

  Sentry.withScope((scope) => {
    if (task) scope.setTag("trigger.task", task);
    Sentry.captureException(error);
  });
}
