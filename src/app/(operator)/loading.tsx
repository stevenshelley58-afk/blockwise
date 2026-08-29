/**
 * Instant loading state for every operator page. All 11 operator pages are
 * dynamic (auth + operator guard + per-page queries on the server), so without
 * this the browser sits on the previous page until the server finishes.
 *
 * This also re-enables <Link> prefetching for the operator group: for a dynamic
 * route Next only prefetches down to the nearest loading boundary, so with no
 * loading.tsx the operator nav prefetched nothing and blocked on a full server
 * render on every single navigation.
 */
export default function OperatorLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6" aria-busy="true" aria-label="Loading">
      <div className="mm-skeleton" style={{ height: 32, width: 260, marginBottom: 24 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: 20, display: "grid", gap: 12 }}>
            <div className="mm-skeleton" style={{ height: 12, width: "55%" }} />
            <div className="mm-skeleton" style={{ height: 22, width: "70%" }} />
          </div>
        ))}
      </div>
      <div className="panel" style={{ padding: 20 }}>
        <div className="mm-skeleton" style={{ height: 14, width: "30%", marginBottom: 14 }} />
        <div className="mm-skeleton" style={{ height: 280, width: "100%" }} />
      </div>
    </main>
  );
}
