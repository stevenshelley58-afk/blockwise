"use client";

import { Button } from "@/components/ui/button";

export default function AssetsError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-3 px-4 py-12 md:px-6">
      <h1 className="text-xl font-semibold">We couldn’t load your assets</h1>
      <p className="text-sm text-muted-foreground">Try again. Your workspace images are unchanged.</p>
      <Button type="button" onClick={reset}>Try again</Button>
    </main>
  );
}
