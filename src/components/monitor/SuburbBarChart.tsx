import { niche } from "@/config/niche";
import type { SuburbPerformance } from "@/lib/meta-monitor/types";

const MAX_ROWS = 10;

export function SuburbBarChart({ rows }: { rows: SuburbPerformance[] }) {
  const top = rows.slice(0, MAX_ROWS);
  const max = Math.max(...top.map((row) => row.validLeads), 1);

  if (top.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-(--line-heavy) px-4 py-6 text-center text-[12.5px] leading-relaxed text-muted-foreground">
        {niche.copy.performance.areaBreakdown.empty}
      </p>
    );
  }

  return (
    <div className="grid gap-[9px]">
      {top.map((row) => (
        <div className="grid grid-cols-[minmax(72px,110px)_1fr_28px] items-center gap-2.5" key={row.suburb}>
          <span className="truncate text-[12px] font-semibold text-foreground" title={row.suburb}>
            {row.suburb}
          </span>
          <span className="h-[9px] w-full overflow-hidden rounded-full bg-data-track">
            <span
              className="block h-full rounded-full bg-data"
              style={{
                width: `${(row.validLeads / max) * 100}%`,
                opacity: 0.45 + 0.55 * (row.validLeads / max),
              }}
            />
          </span>
          <span className="text-right text-[12px] font-bold text-foreground tabular-nums">{row.validLeads}</span>
        </div>
      ))}
    </div>
  );
}
