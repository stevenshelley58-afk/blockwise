import { Skeleton } from "@/components/ui/skeleton";

export default function AdStudioLoading() {
  return (
    <main
      className="fixed inset-0 z-[100] flex flex-col bg-(--canvas) text-foreground"
      aria-busy="true"
      aria-label="Opening Ad Studio"
    >
      <span className="sr-only" role="status">
        Opening Ad Studio
      </span>

      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-(--line) bg-(--surface) px-5 max-[900px]:h-[72px] max-[900px]:px-[18px]">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-4 w-44 rounded-full max-[900px]:w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-24 rounded-(--r-control) max-[900px]:hidden" />
          <Skeleton className="size-11 rounded-(--r-control) min-[901px]:hidden" />
        </div>
      </header>

      <div className="hidden min-h-0 flex-1 grid-cols-[216px_minmax(300px,372px)_minmax(520px,1fr)] min-[901px]:grid">
        <aside className="grid content-start gap-2 border-r border-(--line) bg-(--surface) p-4">
          <Skeleton className="mb-2 h-3 w-20 rounded-full" />
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton className="h-[42px] w-full rounded-(--r-control)" key={index} />
          ))}
        </aside>
        <section className="grid content-start gap-4 border-r border-(--line) p-6">
          <Skeleton className="h-6 w-52 rounded-(--r-card)" />
          <Skeleton className="h-20 w-full rounded-(--r-card)" />
          <Skeleton className="h-32 w-full rounded-(--r-card)" />
          <Skeleton className="h-11 w-full rounded-(--r-control)" />
        </section>
        <section className="grid place-items-center bg-(--surface-subtle) p-8">
          <div className="grid w-full max-w-[440px] gap-4">
            <Skeleton className="mx-auto h-5 w-36 rounded-full" />
            <Skeleton className="mx-auto aspect-[4/5] h-[min(64vh,560px)] rounded-(--r-card)" />
          </div>
        </section>
      </div>

      <section className="grid min-h-0 flex-1 content-start gap-5 overflow-hidden bg-(--surface) px-5 py-6 min-[901px]:hidden">
        <Skeleton className="h-12 w-full rounded-(--r-control)" />
        <div className="grid place-items-center rounded-(--r-panel) bg-(--surface-subtle) px-4 py-6">
          <Skeleton className="aspect-[4/5] w-[min(74vw,320px)] rounded-(--r-card)" />
        </div>
        <Skeleton className="h-24 w-full rounded-(--r-card)" />
      </section>
    </main>
  );
}
