import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const searchInputClassName = "min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/75";
export const sortControlClassName = "h-11 w-full shrink-0 rounded-full border-(--line-heavy) bg-(--surface) text-sm font-semibold text-foreground sm:w-auto";

export function SearchFilterPanel({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <section className={cn("rounded-(--r-panel) border border-(--line) bg-(--surface) p-3 shadow-card", className)} aria-label={label}>
      {children}
    </section>
  );
}

export function SearchField({
  action,
  className,
  containerClassName,
  id,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  action?: ReactNode;
  containerClassName?: string;
  label: string;
}) {
  return (
    <div className={cn("flex min-h-12 w-full items-center gap-3 rounded-(--r-card) border border-(--line-heavy) bg-background px-3 transition focus-within:border-(--ink) focus-within:ring-2 focus-within:ring-(--ink)/10", containerClassName)}>
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} {...props} className={cn(searchInputClassName, className)} />
      {action}
    </div>
  );
}

export function SearchFilterRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function filterChipClassName(active: boolean): string {
  return cn(
    "inline-flex min-h-11 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-(--line) bg-(--surface) text-foreground hover:border-(--line-heavy) hover:bg-(--surface-subtle)",
  );
}
