"use client";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";

/*
 * The bar a Home section ends on when the section's numbers are not the
 * customer's own. It is one component on purpose: the weekly figures and the
 * leads list say the same kind of thing about the same kind of preview, so the
 * two bars cannot drift apart.
 *
 * The amber dot is the same marker Results puts on the same statement, anchored
 * to the sentence's first line rather than to the row so a note that wraps never
 * leaves the dot floating on its own. The action wears the product's own call to
 * action rather than a line of small text.
 */
export function HomeNoticeBar({
  text,
  action,
  marker = true,
}: {
  text: string;
  action: { href: string; label: string };
  /** Off for a notice that reports a fault rather than a preview. */
  marker?: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-4 py-2.5">
      <p className="flex min-w-0 items-start gap-2.5 text-[12.5px] leading-snug text-muted-foreground">
        {marker ? (
          <span className="mt-[6px] size-[8px] shrink-0 rounded-full bg-warning" aria-hidden />
        ) : null}
        <span>{text}</span>
      </p>
      <ButtonArrow href={action.href} className="shrink-0">
        {action.label}
      </ButtonArrow>
    </div>
  );
}
