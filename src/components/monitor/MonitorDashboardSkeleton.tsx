/**
 * Skeleton placeholder for the monitor dashboard. Matches the shape of the
 * real dashboard (chart-first overview panels, then the secondary panels)
 * so a hard-refresh on a slow connection shows premium shape-true loading
 * rather than blank panels or a lone spinner.
 */
export function MonitorDashboardSkeleton() {
  return (
    <div className="mm-page" aria-hidden style={{ gap: 18 }}>
      <div className="mm-skeleton" style={{ height: 72, width: "100%" }} />
      <div className="mm-performance-overview">
        <div className="mm-section-heading">
          <div style={{ width: "100%" }}>
            <div className="mm-skeleton" style={{ height: 20, width: 210, marginBottom: 8 }} />
            <div className="mm-skeleton" style={{ height: 12, width: 92 }} />
          </div>
        </div>
        <div className="mm-performance-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`panel mm-performance-card ${i === 0 ? "mm-performance-card-primary" : ""}`.trim()}
            >
              <div className="mm-skeleton" style={{ height: 16, width: "42%", marginBottom: 8 }} />
              <div className="mm-skeleton" style={{ height: 12, width: "56%", marginBottom: 16 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 18 }}>
                <div className="mm-skeleton" style={{ height: 48, width: "100%" }} />
                <div className="mm-skeleton" style={{ height: 48, width: "100%" }} />
              </div>
              <div className="mm-skeleton" style={{ height: i === 0 ? 232 : 206, width: "100%" }} />
            </div>
          ))}
        </div>
      </div>
      <div
        className="mm-chart-grid two"
        style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr", gap: 14 }}
      >
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: 20 }}>
            <div className="mm-skeleton" style={{ height: 14, width: "50%", marginBottom: 12 }} />
            <div className="mm-skeleton" style={{ height: 180, width: "100%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
