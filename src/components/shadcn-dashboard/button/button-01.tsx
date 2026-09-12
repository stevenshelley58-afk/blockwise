import Link from "next/link";

import { Button, ButtonDisc, ButtonLabel, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * ButtonArrow (shadcn-dashboard) — the signature Blockwise CTA, now the system
 * default: `<Button>` renders the same ink pill with the trailing arrow disc on
 * its own. This stays as a thin, named entry point for the primary "next
 * action" slots, and as the `asChild` composition for link CTAs, where the disc
 * has to be placed inside the anchor by hand.
 */

type ButtonArrowProps = {
  children: React.ReactNode;
  /** When set, the CTA renders as a Next.js Link. */
  href?: string;
  /** Override the disc icon (defaults to the up-right arrow). */
  arrow?: React.ReactNode;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
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
  variant,
  size,
  ...props
}: ButtonArrowProps) {
  if (href) {
    return (
      <Button
        asChild
        variant={variant}
        size={size}
        arrow={arrow}
        className={cn("group/button", className)}
      >
        <Link href={href} {...props}>
          <ButtonLabel>{children}</ButtonLabel>
          {/* Mirrors the Button's own rule: no disc on a link variant. */}
          {arrow === null || variant === "link" ? null : <ButtonDisc arrow={arrow} />}
        </Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} size={size} arrow={arrow} className={className} {...props}>
      {children}
    </Button>
  );
}

export default ButtonArrow;
