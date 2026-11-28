/** The one selectable tile the wizard's first two steps are made of.
 *
 * Shared rather than repeated because the two steps ask different questions
 * with the same control — a multi-select and a single-select that must not
 * look like two different widgets when they sit one click apart. */

import type { ComponentType, ReactNode, SVGProps } from "react";
import { CheckIcon } from "@/lib/icons";

import { cn } from "@/lib/utils";

export function SelectCard({
  selected,
  onClick,
  icon: Icon,
  label,
  hint,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-accent/40"
          : "border-border hover:border-primary/50 hover:bg-accent/30",
      )}
    >
      {selected && (
        <span className="bg-primary text-primary-foreground absolute top-3 right-3 rounded-full p-0.5">
          <CheckIcon className="size-3" aria-hidden="true" />
        </span>
      )}
      <Icon className="text-muted-foreground size-5" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs leading-snug">{hint}</p>
      </div>
      {children}
    </button>
  );
}
