export type StatusTone = "green" | "amber" | "rose" | "blue";

/*
 * Status pill on Blockwise tokens. Previously this rendered the `.status`
 * class from globals.css; because that stylesheet is unlayered it beat every
 * Tailwind utility on the rebuilt customer routes, so the pill is now
 * self-contained. Semantic colour communicates state only.
 */
const TONE_CLASS: Record<StatusTone, string> = {
  green: "bg-success-soft text-success",
  amber: "bg-warning-soft text-warning",
  rose: "bg-error-soft text-error",
  blue: "bg-(--surface-subtle) text-muted-foreground",
};

export function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[10.5px] font-bold whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
