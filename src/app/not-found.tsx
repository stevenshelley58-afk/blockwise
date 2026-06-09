import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="content">
      <section className="panel">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p className="lead">We couldn&apos;t find that page.</p>
        <div className="actions" style={{ marginTop: 18 }}>
          <Link className="button" href="/self-serve">
            Go to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
