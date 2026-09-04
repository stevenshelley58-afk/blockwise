import { Skeleton } from "@/components/ui/skeleton";

export default function LibraryLoading() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-8 md:px-6 md:pb-16 md:pt-10" aria-busy="true" aria-label="Loading Library">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-5 w-[min(30rem,80vw)] rounded-lg" />
        </div>
        <Skeleton className="hidden h-9 w-48 rounded-full sm:block" />
      </div>
      <Skeleton className="mt-8 h-12 w-full rounded-(--r-panel)" />
      <Skeleton className="mt-6 h-12 w-full rounded-(--r-panel)" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="aspect-square rounded-(--r-card)" />)}
      </div>
    </div>
  );
}
