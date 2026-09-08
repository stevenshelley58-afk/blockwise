"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function MobileSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t border-(--line) py-4", className)}>
      {title ? <h2 className="mb-3 text-[15.5px] font-extrabold tracking-[-0.015em]">{title}</h2> : null}
      {children}
    </section>
  );
}

export function ActionRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-12 items-center gap-3 border-b border-(--line) py-2.5 text-left transition-colors last:border-b-0 hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon ? <span aria-hidden className="grid size-8 shrink-0 place-items-center text-muted-foreground">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-[13px] leading-4 text-muted-foreground">{subtitle}</span> : null}
      </span>
      <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
