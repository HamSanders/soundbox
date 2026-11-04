import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // A slow rise and fall over one swell period (index.css), not the
      // stock 2 s pulse.
      className={cn("konchi-swell-breathe rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
