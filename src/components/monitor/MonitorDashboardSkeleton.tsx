import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton placeholder for the monitor dashboard. Matches the shape of the
 * real dashboard (6 KPI tiles, 3 chart panels, 2 wider panels) so a
 * hard-refresh on a slow connection shows premium shape-true loading rather
 * than blank panels or a lone spinner.
 */
export function MonitorDashboardSkeleton() {
  return (
    <div className="grid gap-3.5" aria-hidden>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-(--r-card) border border-(--line) bg-(--surface) px-[18px] pt-[17px] pb-[15px] shadow-card">
            <Skeleton className="h-2.5 w-[55%]" />
            <Skeleton className="mt-3 h-6 w-[70%]" />
            <Skeleton className="mt-3 h-2.5 w-[40%]" />
          </div>
        ))}
      </div>
      <div className="grid gap-3.5 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
            <Skeleton className="h-3.5 w-[45%]" />
            <Skeleton className="mt-4 h-[150px] w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-[2fr_3fr]">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
            <Skeleton className="h-3.5 w-[50%]" />
            <Skeleton className="mt-4 h-[180px] w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
