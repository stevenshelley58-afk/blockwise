"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

/*
 * Root error boundary. Rendered on every surface including customer routes, so
 * it is built on the token bridge rather than globals.css — `.tw` supplies the
 * scoped base layer the no-preflight Tailwind setup needs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="tw grid min-h-[60svh] place-items-center px-4 py-16">
      <section
        role="alert"
        className="w-full max-w-md rounded-(--r-panel) border border-(--line) bg-(--surface) p-8 shadow-card"
      >
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
          Runtime error
        </p>
        <h1 className="mt-2 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          Blockwise hit a recoverable error
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          {process.env.NODE_ENV === "development" && error.message
            ? error.message
            : "The requested workspace view could not be loaded."}
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-(--ink) px-5 text-[13px] font-bold text-white shadow-card transition-colors duration-150 hover:bg-(--accent-strong)"
          >
            Retry
          </button>
          <Link
            href="/self-serve"
            className="inline-flex min-h-11 items-center rounded-full border border-(--line-heavy) bg-(--surface) px-5 text-[13px] font-bold text-foreground transition-colors duration-150 hover:bg-(--surface-subtle)"
          >
            Go to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
