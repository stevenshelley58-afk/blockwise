import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-(--r-ctl) bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
