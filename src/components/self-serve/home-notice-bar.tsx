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
 *
 * The note and the action share one row whenever the note fits beside the
 * action, which is the case for a short note at every width. The note is sized
 * by its own content rather than by what is left over (`basis-auto`, not
 * `basis-0`), so a long note drops the action to the next line instead of being
 * crushed into a column two words wide. The bar tightens its own padding below
 * `sm`; the action keeps the shared CTA's own geometry.
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
    <div
      data-home-notice
      className="mt-3 flex flex-wrap items-center gap-2 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-3 py-2.5 sm:gap-3 sm:px-4">
      <p className="flex min-w-0 flex-[1_1_auto] items-start gap-2.5 text-[12.5px] leading-snug text-muted-foreground">
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
