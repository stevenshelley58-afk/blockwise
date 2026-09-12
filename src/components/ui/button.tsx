import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { ArrowUpRight } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * The Blockwise CTA: a full pill in ink (--ui-cta) with a circular disc on the
 * trailing edge carrying an up-right arrow. Selection guide:
 *
 *   default    the ink pill with the arrow disc — the primary "go" action
 *   outline    the same pill in surface white with a Control Line boundary
 *   secondary  a quiet fill for an action inside a card or toolbar
 *   ghost      no chrome until hover
 *   destructive the error surface, with the same inverse disc
 *   link       inline text action, never a pill
 *   ghost-pill the Premium v2 36px toolbar/page-head control
 *
 * The disc drops automatically for icon-only buttons and for `link`, and can be
 * turned off per call site with `arrow={null}`. On hover the arrow turns to
 * point up and the disc lifts a touch — transform and shadow only, 500ms, both
 * skipped under reduced motion. See DESIGN.md §Components.
 */

/**
 * True when a button's children render visible text (not just an icon).
 *
 * Host elements and plain function components are read directly. Everything
 * else — `next/link`, lucide icons, forwardRef and memo wrappers — is an object
 * whose `children` we can still read: a `<Link>Start free</Link>` has text and
 * earns the disc, a `<Link><ArrowRight /></Link>` has none. The `symbol` test
 * turns away fragments, portals and context consumers, which have no readable
 * children and are never the text in a label.
 */
function hasTextContent(node: React.ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") {
    return String(node).trim().length > 0
  }
  if (Array.isArray(node)) return node.some(hasTextContent)
  if (React.isValidElement(node)) {
    const type = node.type as React.ElementType & { $$typeof?: symbol }
    if (typeof type === "symbol") return false
    return hasTextContent((node.props as { children?: React.ReactNode }).children)
  }
  return false
}

/*
 * Disc geometry per control height, so the disc is a (height − 6px) circle with
 * a 3px ink ring at every size, matching the reference CTA.
 *
 * `DISC_LANE` reserves the trailing lane the disc sits in, so the label can never
 * run underneath it. The lane is held in both states: swapping it to the leading
 * edge on hover would change the pill's intrinsic width mid-transition and make
 * every CTA twitch, so the hover lives inside the disc instead.
 */
const DISC_LANE = "has-data-[slot=button-disc]:pr-12"

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
    "group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full text-sm font-semibold whitespace-nowrap transition-all outline-none",
    // The disc is the inverse of the ink pill: a cta-foreground (white) circle
    // with an ink arrow, which is what makes the CTA read as one object. The
    // quiet variants inherit the same disc. Variants that need another disc
    // colour restate these two on the variant, which wins by source order.
    "[--cta-disc:var(--ui-cta-foreground)] [--cta-disc-foreground:var(--ui-cta)]",
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-cta text-cta-foreground hover:bg-cta/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        // The quiet variants sit on a light surface, so their disc takes a soft
        // ink wash: a cta-foreground disc there is invisible against `--bg`.
        outline:
          "border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground [--cta-disc:var(--ui-cta-soft)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 [--cta-disc:var(--ui-cta-soft)]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 [--cta-disc:var(--ui-cta-soft)]",
        // Premium v2 "ghost button": full pill on Clean Surface with a Control
        // Line boundary and ink label (DESIGN.md §7 Controls). Pair with
        // `size="pill"` for the 36px toolbar/page-head control.
        "ghost-pill":
          "border border-(--line-heavy) bg-card text-foreground hover:bg-(--surface-subtle) hover:shadow-card disabled:opacity-60 [--cta-disc:var(--ui-cta-soft)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: `h-10 px-5 [--cta-disc-size:2rem] [--cta-disc-inset:0.25rem] [--cta-disc-icon:1rem] ${DISC_LANE}`,
        xs: "h-7 gap-1 px-3 text-xs [--cta-disc-size:1.375rem] [--cta-disc-inset:0.1875rem] [--cta-disc-icon:0.75rem] [&_svg:not([class*='size-'])]:size-3 has-data-[slot=button-disc]:pr-9",
        sm: "h-8 gap-1.5 px-4 [--cta-disc-size:1.625rem] [--cta-disc-inset:0.1875rem] [--cta-disc-icon:0.875rem] has-data-[slot=button-disc]:pr-10",
        lg: "h-12 gap-2 px-6 text-[15px] [--cta-disc-size:2.625rem] [--cta-disc-inset:0.1875rem] [--cta-disc-icon:1.25rem] has-data-[slot=button-disc]:pr-14",
        pill: "h-9 gap-2 px-3.5 text-[12.5px] font-bold [--cta-disc-size:1.75rem] [--cta-disc-inset:0.25rem] [--cta-disc-icon:0.875rem] has-data-[slot=button-disc]:pr-11",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
      disc: {
        default: "",
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      disc: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * Disc contents. Defaults to the up-right arrow; `null` removes the disc
     * entirely (icon-only controls, inline text actions); any other node
     * replaces the arrow but keeps the disc.
     */
    arrow?: React.ReactNode
  }

/** The CTA label, lifted above the disc as it crosses the pill. */
function ButtonLabel({ children }: { children: React.ReactNode }) {
  return <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
}

/**
 * The trailing circular disc: the inverse of the pill, `--cta-disc` (a
 * cta-foreground circle by default) with the arrow in `--cta-disc-foreground`.
 * Both are set on the Button, so the disc keeps its colours even when the host
 * element's own text colour differs, as it does for `asChild` links.
 *
 * Hover is contained to the disc: it lifts a touch and the arrow turns to point
 * where the action leads. Nothing here changes the pill's size, and everything
 * is transform-only, so a row of CTAs cannot shift under the pointer.
 */
function ButtonDisc({ arrow }: { arrow?: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      data-slot="button-disc"
      className="pointer-events-none absolute top-1/2 right-(--cta-disc-inset) z-0 flex size-(--cta-disc-size) -translate-y-1/2 items-center justify-center rounded-full bg-(--cta-disc) text-(--cta-disc-foreground) shadow-[0_1px_2px_rgba(16,18,23,0.10)] transition-all duration-500 ease-spring group-hover/button:shadow-[0_2px_6px_rgba(16,18,23,0.18)] motion-reduce:transition-none"
    >
      {/* The doubled `group-hover/button:` is load-bearing: it lifts the hover
          rotation above the reduced-motion `rotate-0` override, which otherwise
          wins on source order and leaves the arrow never turning. */}
      <span className="flex size-(--cta-disc-icon) rotate-0 items-center justify-center transition-transform duration-500 ease-spring group-hover/button:group-hover/button:rotate-45 motion-reduce:transition-none motion-reduce:group-hover/button:rotate-0 [&_svg]:size-full">
        {arrow ?? <ArrowUpRight strokeWidth={2.25} />}
      </span>
    </span>
  )
}

/**
 * Contents every CTA shares, so the plain and `asChild` paths cannot drift.
 * The disc is absolutely positioned in the lane reserved by the button's
 * `has-data-[slot=button-disc]` padding, and only the label sits in flow.
 */
function ButtonContents({
  children,
  arrow,
  showDisc,
}: {
  children: React.ReactNode
  arrow?: React.ReactNode
  showDisc: boolean
}) {
  return (
    <>
      <ButtonLabel>{children}</ButtonLabel>
      {showDisc ? <ButtonDisc arrow={arrow ?? undefined} /> : null}
    </>
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  disc,
  asChild = false,
  arrow,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"
  const showDisc =
    disc !== "none" && arrow !== null && variant !== "link" && hasTextContent(children)

  return (
    <Comp
      data-slot="button"
      data-cta="pill"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, disc, className }), CTA_MARKER)}
      {...(props as React.ComponentProps<"button">)}
    >
      {asChild ? (
        // Slot merges our props into the child element, but it cannot wrap that
        // child's own contents, so the label and disc are cloned into it. The
        // button's `has-data-[slot=button-disc]` padding then applies unchanged.
        <ButtonChild showDisc={showDisc} arrow={arrow}>
          {children}
        </ButtonChild>
      ) : (
        <ButtonContents showDisc={showDisc} arrow={arrow}>
          {children}
        </ButtonContents>
      )}
    </Comp>
  )
}

/*
 * With `asChild`, Slot merges the button's props onto the child element, but it
 * cannot wrap that element's own contents. ButtonChild is the single child Slot
 * sees: it re-applies the merged props to the real child (the Link or anchor)
 * and swaps in the label and disc. ButtonDisc, ButtonLabel and the disc lane are
 * already resolved by then, so the anchor renders exactly like the button would.
 */
function ButtonChild({
  children,
  showDisc,
  arrow,
  disc: _disc,
  className,
  ...props
}: {
  children: React.ReactNode
  showDisc: boolean
  arrow?: React.ReactNode
  disc?: "default" | "none"
  className?: string
} & Record<string, unknown>) {
  if (!React.isValidElement(children)) return <>{children}</>
  const child = children as React.ReactElement<{
    children?: React.ReactNode
    className?: string
    "data-cta"?: string
  }>
  return React.cloneElement(
    child,
    {
      // The card's own props go first so the Slot-merged ones win: the child must
      // not be able to drop the button's data-slot, which its CTA-reset rules key
      // on. `data-cta` repeats it for surfaces that reset bare anchors.
      ...child.props,
      ...props,
      "data-cta": "pill",
      className: cn(className, child.props.className),
    },
    <ButtonContents showDisc={showDisc} arrow={arrow}>
      {child.props.children}
    </ButtonContents>,
  )
}

export { Button, ButtonDisc, ButtonLabel, buttonVariants, hasTextContent }
export type { ButtonProps }
