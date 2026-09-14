import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * The Blockwise control. One button, defined here, used everywhere.
 *
 * There is NO automatically injected trailing arrow disc. Plain text is the
 * default: a label, and nothing decorating it. An icon goes inside the button
 * only when it carries a function the label does not already state, such as
 * Back, expand, download or external navigation, and it is written into
 * `children` like any other content. A decorative arrow on a text button is a
 * regression, not a style: see docs/design/design-system.md "Controls".
 *
 * Selection guide:
 *
 *   default      the ink pill; the one primary action in a task area
 *   outline      the same pill in surface with an interactive boundary, for the
 *                secondary action beside it
 *   secondary    a quiet fill for an action inside a card or toolbar
 *   ghost        no chrome until hover
 *   destructive  the error surface
 *   link         inline text action, never a pill
 *   ghost-pill   the 36px toolbar and page-head control
 */

/*
 * Marker for the CTA reset rules on the legacy marketing sheets (audit.css,
 * suburb-report.css). Those sheets are unlayered, so their `.page a` and
 * `.page button` element rules outrank every Tailwind utility; they exclude this
 * class instead. It lives in `className` rather than a data attribute because a
 * `className` is the one prop every wrapper component in this codebase forwards.
 */
const CTA_MARKER = "bw-cta"

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-control font-semibold whitespace-nowrap transition-colors outline-none",
    // Focus is one shared treatment across every control: a solid 3px indicator
    // in the focus role, with the control's own boundary switching to it so the
    // ring reads as part of the control rather than floating beside it. Solid,
    // not a translucent tint, so it stays visible against the control and
    // against whatever surface sits behind it, in both themes.
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-cta text-cta-foreground hover:bg-cta/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        // The boundary is the interactive-boundary role, not the decorative
        // divider: a control a person can act on needs an edge they can see.
        outline:
          "border border-(--ui-control-border) bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        // Premium v2 "ghost button": full pill on Clean Surface with an
        // interactive boundary and ink label. Pair with `size="pill"` for the
        // 36px toolbar/page-head control.
        "ghost-pill":
          "border border-(--ui-control-border) bg-card text-foreground hover:bg-(--surface-subtle) hover:shadow-card disabled:opacity-60",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5",
        xs: "h-7 gap-1 px-3 text-meta [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-4",
        lg: "h-12 gap-2 px-6 text-body",
        pill: "h-9 gap-2 px-3.5 text-meta font-bold",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

/**
 * Renders a real `<button>` with its own type, or the caller's own element when
 * `asChild` is set, so a link CTA is an `<a>` and never a clickable `div`. With
 * `asChild`, Radix Slot merges these props onto the child, which is why the
 * marker class and `data-cta` travel in `className` and props rather than in
 * wrapper markup.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-cta="pill"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }), CTA_MARKER)}
      {...(props as React.ComponentProps<"button">)}
    >
      {children}
    </Comp>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
