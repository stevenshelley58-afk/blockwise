import { Skeleton } from "@/components/ui/skeleton";

export default function SelfServeLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Home" data-home-creative
      className="mx-auto w-full max-w-[1120px] px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 md:px-6 md:pb-12 md:pt-7">
      <span className="sr-only">Loading Home</span>
      <section>
        <Skeleton className="h-3 w-36 rounded-full" />
        <Skeleton className="mt-3 h-8 w-56 max-w-full rounded-(--r-ctl)" />
        <div className="mt-6 grid items-start gap-6 md:mt-8 md:grid-cols-[minmax(260px,0.95fr)_minmax(260px,1fr)] md:items-center md:gap-10">
          <Skeleton className="h-[300px] w-[240px] max-w-full rounded-(--r-card) md:h-[360px] md:w-[288px]" />
          <div>
            <Skeleton className="h-3 w-40 rounded-full" />
            <Skeleton className="mt-3 h-8 w-56 max-w-full rounded-(--r-ctl)" />
            <Skeleton className="mt-5 h-12 w-32 rounded-(--r-ctl)" />
            <Skeleton className="mt-4 h-4 w-36 rounded-full" />
          </div>
        </div>
      </section>
    </div>
  );
}
