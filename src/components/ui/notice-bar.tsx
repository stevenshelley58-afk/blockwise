"use client";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { cn } from "@/lib/utils";

/*
 * The bar a block of figures ends on when those figures are not the customer's
 * own. It is one component on purpose: Home's weekly figures, Home's example
 * leads and Results' example report label the same kind of preview, so the bars
 * cannot drift apart — same bar, same note, same action.
 *
 * The amber dot is the marker every preview statement wears, anchored to the
 * sentence's first line rather than to the row so a note that wraps never
 * leaves the dot floating on its own. The action wears the product's own call
 * to action rather than a line of small text.
 *
 * The note and the action share one row whenever the note fits beside the
 * action. The note is sized by its own content rather than by what is left over
 * (`basis-auto`, not `basis-0`), so a long note drops the action to the next
 * line instead of being crushed into a column two words wide. The bar tightens
 * its own padding below `sm`; the action keeps the shared CTA's own geometry.
 *
 * The bar carries `mt-3`, the gap it was built for in a section's flow. A
 * surface that lays its own gap out — Results' dashboard grid — passes
 * `className` to state the space itself.
 */
export function NoticeBar({
  text,
  action,
  marker = true,
  className,
}: {
  text: string;
  action: { href: string; label: string };
  /** Off for a notice that reports a fault rather than a preview. */
  marker?: boolean;
  className?: string;
}) {
  return (
    <div
      data-notice-bar
      className={cn(
        "mt-3 flex flex-wrap items-center gap-2 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-3 py-2.5 sm:gap-3 sm:px-4",
        className,
      )}
    >
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
