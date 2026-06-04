import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="content">
      <section className="panel">
        <p className="eyebrow">404</p>
        <h1>Workspace view not found</h1>
        <p className="lead">The route is not part of the current Blockwise release surface.</p>
        <div className="actions" style={{ marginTop: 18 }}>
          <Link className="button" href="/operator">
            Open Operator Console
          </Link>
        </div>
      </section>
    </main>
  );
}
