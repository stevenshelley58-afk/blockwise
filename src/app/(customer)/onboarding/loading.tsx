import { Skeleton } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16" aria-label="Onboarding">
      <header className="mb-6">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="mt-2 h-7 w-56 rounded-(--r-card)" />
        <Skeleton className="mt-2 h-4 w-72 rounded-full" />
      </header>

      <div className="grid gap-5">
        <div>
          <div className="flex items-start">
            {[0, 1, 2].map((i) => (
              <div className="flex flex-1 flex-col items-center gap-1.5" key={i}>
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-3 w-12 rounded-full" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-1 w-full rounded-full" />
        </div>

        <div className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-6 shadow-card">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-5 w-44 rounded-(--r-card)" />
              <Skeleton className="mt-1.5 h-4 w-64 rounded-full" />
            </div>
          </div>
          <Skeleton className="mt-5 h-9 w-full rounded-(--r-card)" />
          <Skeleton className="mt-3 h-9 w-full rounded-(--r-card)" />
          <div className="mt-5 flex justify-end gap-2">
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
        </div>
      </div>
    </main>
  );
}
