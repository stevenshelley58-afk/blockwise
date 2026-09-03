"use client";

export default function AdsError({ reset }: { reset: () => void }) {
  return <div className="grid min-h-[50vh] place-items-center p-6"><div role="alert" className="max-w-md rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-6"><h1 className="font-display text-[17px] font-extrabold">Couldn’t load this ad</h1><p className="mt-2 text-sm text-muted-foreground">Your saved work is unchanged. Refresh this view to try loading the workspace assets again.</p><button type="button" onClick={reset} className="mt-5 min-h-11 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground">Try again</button></div></div>;
}
