import Link from "next/link";

import { Button } from "@/components/ui/button";

/*
 * Root 404. Rendered on every surface including customer routes, so it is
 * built on the token bridge rather than globals.css — `.tw` supplies the
 * scoped base layer the no-preflight Tailwind setup needs.
 */
export default function NotFoundPage() {
  return (
    <main className="tw grid min-h-[60svh] place-items-center px-4 py-16">
      <section className="w-full max-w-md rounded-(--r-panel) border border-(--line) bg-(--surface) p-8 shadow-card">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">404</p>
        <h1 className="mt-2 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          This page does not exist
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">The link you followed might be broken, or the page may have moved.</p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/self-serve">Go to dashboard</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
