"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";

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
          <Button type="button" onClick={() => reset()}>
            Retry
          </Button>
          <Button asChild variant="outline">
            <Link href="/self-serve">Go to dashboard</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
