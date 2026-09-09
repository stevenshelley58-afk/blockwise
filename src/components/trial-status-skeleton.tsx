export function TrialStatusSkeleton() {
  return (
    <div className="animate-pulse rounded-(--r-card) border border-border bg-card p-3">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="mt-2 h-2 w-full rounded bg-muted" />
      <div className="mt-1.5 h-2 w-2/3 rounded bg-muted" />
    </div>
  );
}
