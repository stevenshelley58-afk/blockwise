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

  const capture = () => {
    Sentry.captureException(error);
  };

  if (typeof Sentry.withScope === "function" && typeof Sentry.captureException === "function") {
    Sentry.withScope((scope) => {
      if (task) scope.setTag("trigger.task", task);
      capture();
    });
    return;
  }

  if (typeof Sentry.captureException === "function") {
    capture();
    return;
  }

  console.error("[trigger] unreported exception", task ? { task, error } : error);
}
