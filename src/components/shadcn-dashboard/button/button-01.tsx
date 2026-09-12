import Link from "next/link";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * ButtonArrow (shadcn-dashboard) — the signature Blockwise CTA, now the system
 * default: `<Button>` renders the same ink pill with the trailing arrow disc on
 * its own, for a button and for a link alike. This stays as a thin, named entry
 * point for the primary "next action" slots.
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
        {/* Label and disc are the Button's to place on both paths: `asChild`
            clones them into the anchor itself. Handing them in here as well put
            two discs in every link CTA and squeezed the label into the lane of
            the first one. */}
        <Link href={href} {...props}>
          {children}
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
