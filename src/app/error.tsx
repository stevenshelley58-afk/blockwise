"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

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
    <main className="content">
      <section className="panel">
        <p className="eyebrow">Runtime error</p>
        <h1>Blockwise hit a recoverable error</h1>
        <p className="lead">
          {process.env.NODE_ENV === "development" && error.message
            ? error.message
            : "The requested workspace view could not be loaded."}
        </p>
        <div className="actions" style={{ marginTop: 18 }}>
          <button className="button" onClick={() => reset()} type="button">
            Retry
          </button>
          <Link className="button secondary" href="/self-serve">
            Go to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
