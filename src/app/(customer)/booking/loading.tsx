import { Skeleton } from "@/components/ui/skeleton";

export default function BookingLoading() {
  return (
    <main className="mx-auto grid w-full max-w-[720px] gap-5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16" aria-label="Loading booking">
      <div className="grid gap-3">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-5 w-full max-w-[580px]" />
      </div>
      <Skeleton className="h-[270px] rounded-(--r-panel)" />
    </main>
  );
}
