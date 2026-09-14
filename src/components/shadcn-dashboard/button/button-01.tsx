import Link from "next/link";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * CtaLink — a thin, named entry point for the primary "next action" slot, which
 * renders as a Next.js Link when `href` is set and as the shared Button
 * otherwise.
 *
 * It used to be called ButtonArrow and carried a trailing arrow disc. The disc
 * is gone system-wide: plain text is the default on every text button, so this
 * wrapper no longer decorates anything. The name follows the behaviour, because
 * a component called ButtonArrow that draws no arrow is exactly the kind of
 * drift this consolidation exists to remove.
 *
 * See docs/design/design-system.md "Controls".
 */

type CtaLinkProps = {
  children: React.ReactNode;
  /** When set, the CTA renders as a Next.js Link. */
  href?: string;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  "aria-label"?: string;
};

export function CtaLink({
  href,
  className,
  children,
  variant,
  size,
  ...props
}: CtaLinkProps) {
  if (href) {
    return (
      <Button
        asChild
        variant={variant}
        size={size}
        className={cn("group/button", className)}
      >
        <Link href={href} {...props}>
          {children}
        </Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} size={size} className={className} {...props}>
      {children}
    </Button>
  );
}

export default CtaLink;
