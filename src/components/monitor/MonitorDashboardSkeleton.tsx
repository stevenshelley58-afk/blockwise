/**
 * Skeleton placeholder for the monitor dashboard. Matches the shape of the
 * real dashboard (6 KPI cards in a 6-col grid, 3 chart panels, 2 wider panels)
 * so a hard-refresh on a slow connection shows premium shape-true loading
 * rather than blank panels or a lone spinner.
 */
export function MonitorDashboardSkeleton() {
  return (
    <div className="mm-page" aria-hidden style={{ gap: 18 }}>
      <div className="mm-skeleton" style={{ height: 72, width: "100%" }} />
      <div
        className="mm-kpi-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14 }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: 20, display: "grid", gap: 12 }}>
            <div className="mm-skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
            <div className="mm-skeleton" style={{ height: 12, width: "55%" }} />
            <div className="mm-skeleton" style={{ height: 22, width: "70%" }} />
            <div className="mm-skeleton" style={{ height: 10, width: "40%" }} />
          </div>
        ))}
      </div>
      <div
        className="mm-chart-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel" style={{ padding: 20 }}>
            <div className="mm-skeleton" style={{ height: 14, width: "40%", marginBottom: 12 }} />
            <div className="mm-skeleton" style={{ height: 140, width: "100%" }} />
          </div>
        ))}
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
