/**
 * The one shape for "there is nothing here", and for "this failed to load".
 *
 * Every list in the app had its own dashed box — five paddings, two radii,
 * some with an icon disc and some without. This is that box once: a quiet
 * panel with a flat line through it, because in an audio tool the honest
 * picture of nothing is silence. Errors use the same panel with a danger
 * edge, so a failed load never looks like an empty library.
 */

import type { LucideIcon } from "@/lib/icons";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A flat line with a little residual noise — a channel with no signal. */
function Silence({ className }: { className?: string }) {
  const bars = [2, 2, 3, 2, 2, 2, 4, 2, 2, 3, 2, 2, 2, 2, 3, 2, 2, 4, 2, 2, 2, 3, 2, 2];
  return (
    <svg
      viewBox={`0 0 ${bars.length * 4} 12`}
      className={cn("h-3 w-24", className)}
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((h, i) => (
        <rect key={i} x={i * 4} y={(12 - h) / 2} width={2} height={h} rx={1} fill="currentColor" />
      ))}
    </svg>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  tone = "empty",
  size = "default",
  className,
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  /** The sentence under the title: what to do about it. */
  children?: ReactNode;
  action?: ReactNode;
  tone?: "empty" | "error";
  /** `sm` for a slot inside a page section, `default` for a page's only list. */
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "text-muted-foreground bg-muted/25 ring-border animate-in fade-in-0 flex flex-col items-center gap-2 rounded-xl px-6 text-center text-sm ring-1 ring-inset duration-300",
        size === "sm" ? "py-8" : "py-14",
        tone === "error" && "bg-danger/5 ring-danger/30",
        className,
      )}
    >
      {Icon ? (
        <div className="bg-card ring-border mb-1 flex size-10 items-center justify-center rounded-lg ring-1 ring-inset">
          <Icon className="text-muted-foreground size-5" aria-hidden="true" />
        </div>
      ) : (
        <Silence className={cn("mb-1", tone === "error" ? "text-danger/60" : "text-border-strong")} />
      )}
      {title && <p className="text-foreground text-sm font-medium">{title}</p>}
      {children && <div className="max-w-sm text-sm text-balance">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
