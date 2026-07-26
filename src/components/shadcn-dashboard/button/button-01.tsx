import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * button-01 (shadcn-dashboard) — the signature Blockwise CTA.
 *
 * A pill button with a circular arrow disc that slides across and rotates on
 * hover. Used for the primary "next action" on a screen. Pass `href` to render
 * it as a Next.js Link while keeping the same structure and animation.
 */

const BUTTON_ARROW_CLASSES =
  "group relative h-12 w-fit overflow-hidden rounded-full p-1 ps-6 pe-14 text-sm font-medium transition-all duration-500 hover:pe-6 hover:ps-14";

type ButtonArrowProps = {
  children: React.ReactNode;
  /** When set, the CTA renders as a Next.js Link. */
  href?: string;
  /** Override the arrow icon (defaults to ArrowUpRight). */
  arrow?: React.ReactNode;
  className?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-label"?: string;
};

export function ButtonArrow({
  href,
  arrow,
  className,
  children,
  type,
  disabled,
  onClick,
  "aria-label": ariaLabel,
}: ButtonArrowProps) {
  const inner = (
    <>
      <span className="relative z-10 inline-flex items-center gap-2 transition-all duration-500">
        {children}
      </span>
      <span
        aria-hidden
        className="absolute right-1 flex size-10 items-center justify-center rounded-full bg-background text-foreground transition-all duration-500 group-hover:right-[calc(100%-44px)] group-hover:rotate-45"
      >
        {arrow ?? <ArrowUpRight size={16} />}
      </span>
    </>
  );

  const classes = cn(BUTTON_ARROW_CLASSES, className);

  if (href) {
    return (
      <Button asChild className={classes}>
        <Link href={href} onClick={onClick} aria-label={ariaLabel}>
          {inner}
        </Link>
      </Button>
    );
  }

  return (
    <Button className={classes} type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {inner}
    </Button>
  );
}

export default ButtonArrow;
