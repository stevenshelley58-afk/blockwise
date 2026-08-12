import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdStudioPage() {
  await requirePageSurfaceAccess("adstudio");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-(--canvas) px-6 text-center">
      <div className="grid max-w-md gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Ad Studio is being prepared
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          We&rsquo;re rebuilding Ad Studio with a new layered editor, faster
          generation, and smarter publishing. It will be available again soon.
        </p>
        <p className="text-sm text-muted-foreground">
          Your existing campaigns, creatives, and Meta connections are safe
          and unchanged.
        </p>
      </div>
    </main>
  );
}
