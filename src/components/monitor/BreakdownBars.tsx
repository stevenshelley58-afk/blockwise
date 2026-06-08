export function BreakdownBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; percentage: number }>;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mm-breakdown">
      <h5>{title}</h5>
      {rows.slice(0, 4).map((row) => (
        <div className="mm-breakdown-row" key={row.label}>
          <div className="mm-breakdown-bar">
            <span className="mm-breakdown-label">{row.label}</span>
            <span className="mm-breakdown-track">
              <span className="mm-breakdown-fill" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
            </span>
          </div>
          <span className="mm-breakdown-pct">{row.percentage}%</span>
        </div>
      ))}
    </div>
  );
}
