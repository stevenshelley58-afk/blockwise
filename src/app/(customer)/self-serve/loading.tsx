import { Skeleton } from "@/components/ui/skeleton";

export default function SelfServeLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Home" className="mx-auto grid w-full max-w-[1120px] gap-0 px-4 pt-5 pb-24 md:px-6 md:pt-7 md:pb-12">
      <span className="sr-only">Loading Home</span>
      <div className="border-b border-(--line) pb-4">
        <Skeleton className="h-7 w-24 rounded-(--r-control)" />
        <Skeleton className="mt-2 h-3 w-36 rounded-full" />
      </div>
      <div className="border-b border-(--line) py-4">
        <Skeleton className="h-5 w-56 rounded-(--r-control)" />
        <Skeleton className="mt-2 h-3 w-40 rounded-full" />
        <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
        <Skeleton className="mt-4 h-11 w-36 rounded-full" />
      </div>
      <div className="border-b border-(--line) py-4">
        <Skeleton className="h-4 w-20 rounded-(--r-control)" />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton className="h-3 w-20 rounded-full" /><Skeleton className="mt-2 h-6 w-16 rounded-(--r-control)" /></div>)}
        </div>
      </div>
      <div className="py-4">
        <Skeleton className="h-4 w-16 rounded-(--r-control)" />
        <Skeleton className="mt-3 h-12 w-full rounded-(--r-control)" />
      </div>
    </div>
  );
}
