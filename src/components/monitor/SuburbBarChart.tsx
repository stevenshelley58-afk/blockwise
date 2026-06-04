import type { SuburbPerformance } from "@/lib/meta-monitor/types";

const MAX_ROWS = 10;

export function SuburbBarChart({ rows }: { rows: SuburbPerformance[] }) {
  const top = rows.slice(0, MAX_ROWS);
  const max = Math.max(...top.map((row) => row.validLeads), 1);

  if (top.length === 0) {
    return (
      <p className="mm-chart-empty">
        No suburb attribution yet. Suburbs come from lead records or the &quot;Suburb - Name&quot; ad set
        convention — never from Meta geo estimates.
      </p>
    );
  }

  return (
    <div className="mm-suburb-bars">
      {top.map((row) => (
        <div className="mm-suburb-row" key={row.suburb}>
          <span className="mm-suburb-name" title={row.suburb}>
            {row.suburb}
          </span>
          <span className="mm-suburb-track">
            <span
              className="mm-suburb-fill"
              style={{
                width: `${(row.validLeads / max) * 100}%`,
                opacity: 0.45 + 0.55 * (row.validLeads / max),
              }}
            />
          </span>
          <span className="mm-suburb-count">{row.validLeads}</span>
        </div>
      ))}
    </div>
  );
}
