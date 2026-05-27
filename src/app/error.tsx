"use client";

import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="content">
      <section className="panel">
        <p className="eyebrow">Runtime error</p>
        <h1>Blockwise hit a recoverable error</h1>
        <p className="lead">{error.message || "The requested workspace view could not be loaded."}</p>
        <div className="actions" style={{ marginTop: 18 }}>
          <button className="button" onClick={() => reset()} type="button">
            Retry
          </button>
          <Link className="button secondary" href="/operator">
            Operator Console
          </Link>
        </div>
      </section>
    </main>
  );
}
