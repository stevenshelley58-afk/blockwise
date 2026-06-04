const DEVICE_COLORS = ["var(--blue)", "var(--green)", "#b45309"];
const CIRCUMFERENCE = 2 * Math.PI * 15.915;

export function DeviceDonut({ rows }: { rows: Array<{ label: string; percentage: number }> }) {
  if (rows.length === 0) {
    return null;
  }

  const top = rows.slice(0, 3);
  let accumulated = 0;

  return (
    <div className="mm-breakdown">
      <h5>Device</h5>
      <div className="mm-donut">
        <svg width="72" height="72" viewBox="0 0 42 42" role="img" aria-label="Device breakdown">
          {top.map((row, index) => {
            const length = (row.percentage / 100) * CIRCUMFERENCE;
            const offset = CIRCUMFERENCE / 4 - (accumulated / 100) * CIRCUMFERENCE;

            accumulated += row.percentage;

            return (
              <circle
                key={row.label}
                r="15.915"
                cx="21"
                cy="21"
                fill="none"
                stroke={DEVICE_COLORS[index % DEVICE_COLORS.length]}
                strokeWidth="7"
                strokeDasharray={`${length.toFixed(2)} ${(CIRCUMFERENCE - length).toFixed(2)}`}
                strokeDashoffset={offset.toFixed(2)}
              />
            );
          })}
        </svg>
        <ul className="mm-donut-legend">
          {top.map((row, index) => (
            <li key={row.label}>
              <i style={{ background: DEVICE_COLORS[index % DEVICE_COLORS.length] }} aria-hidden />
              {row.label} <b>{row.percentage}%</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
