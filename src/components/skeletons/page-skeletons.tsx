import { Skeleton } from "@/components/ui/skeleton";

/*
 * Shared route-level loading skeletons for the customer surface. Each mirrors
 * the geometry of the page it stands in for, so first paint does not reflow
 * when real content arrives. Every customer route is `force-dynamic` with
 * awaited Supabase reads, so these are the first thing the visitor sees.
 */

/** Page shell: constrained column, mobile bottom-nav clearance. */
export function SkeletonPage({
  children,
  label,
  width = "max-w-[1120px]",
}: {
  children: React.ReactNode;
  label: string;
  width?: string;
}) {
  return (
    <main
      aria-busy="true"
      aria-label={label}
      className={`mx-auto grid w-full ${width} gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16`}
    >
      <span className="sr-only" role="status">
        Loading {label}
      </span>
      {children}
    </main>
  );
}

export function SkeletonPageHead({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Skeleton className="h-7 w-56 rounded-(--r-card)" />
        <Skeleton className="mt-2 h-4 w-72 rounded-full" />
      </div>
      {action ? <Skeleton className="h-11 w-32 rounded-full" /> : null}
    </div>
  );
}

export function SkeletonStatRow({ count = 4 }: { count?: number }) {
  return (
    <div
      className={`grid grid-cols-2 gap-3.5 ${count === 3 ? "lg:grid-cols-3" : "xl:grid-cols-4"}`}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-(--r-card) border border-(--line) bg-(--surface) px-[18px] pt-[17px] pb-[15px] shadow-card"
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-2.5 w-20 rounded-full" />
            <Skeleton className="size-[30px] rounded-[9px]" />
          </div>
          <Skeleton className="mt-3 h-7 w-24 rounded-(--r-card)" />
          <Skeleton className="mt-2.5 h-3 w-28 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ height = "h-[218px]" }: { height?: string }) {
  return (
    <div className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
      <Skeleton className="h-4 w-40 rounded-(--r-card)" />
      <Skeleton className="mt-1.5 h-3 w-52 rounded-full" />
      <Skeleton className={`mt-4 w-full rounded-(--r-card) ${height}`} />
    </div>
  );
}

export function SkeletonTablePanel({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-(--r-panel) border border-(--line) bg-(--surface) shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-(--line) p-4">
        <Skeleton className="h-11 w-full rounded-(--r-control) sm:h-9 sm:w-56" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="grid gap-3 p-4">
        {Array.from({ length: rows }, (_, index) => (
          <div className="flex items-center gap-3" key={index}>
            <Skeleton className="h-4 flex-1 rounded-full" />
            <Skeleton className="hidden h-4 w-28 rounded-full sm:block" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
