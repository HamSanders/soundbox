/**
 * The filter row's pills: a dropdown pill that names its choice once one is
 * made ("Model · Kokoro"), a toggle pill that is filled when on, and a chip
 * whose × clears one chosen value. The Library and the Voice Lab share them so
 * a filter looks the same on every page that has one.
 */

import type { ReactNode } from "react";
import { ChevronDownIcon, XIcon } from "@/lib/icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PILL =
  "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 [&_svg]:size-3.5";
const PILL_OFF = "border-border text-muted-foreground hover:text-foreground hover:bg-muted";
const PILL_ON = "bg-primary text-primary-foreground border-primary";

/** A filter with a list of values, as a pill that opens a menu. */
export function FilterMenu({
  label,
  value,
  valueLabel,
  anyLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  valueLabel?: string;
  anyLabel: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(PILL, value ? PILL_ON : PILL_OFF)}
          aria-label={value ? `${label}: ${valueLabel ?? value}. Change.` : `Filter by ${label.toLowerCase()}`}
        >
          {label}
          {value && <span className="max-w-32 truncate font-normal opacity-80">· {valueLabel ?? value}</span>}
          <ChevronDownIcon aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <DropdownMenuRadioItem value="">{anyLabel}</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="readout text-muted-foreground ml-auto pl-2">{o.hint}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An on/off filter, as a pill that is filled when on. */
export function TogglePill({
  pressed,
  onToggle,
  icon,
  label,
}: {
  pressed: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onToggle} className={cn(PILL, pressed ? PILL_ON : PILL_OFF)}>
      {icon}
      {label}
    </button>
  );
}

/** One chosen filter value, as a chip whose × clears only it. */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="bg-muted text-foreground inline-flex h-8 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-full p-0.5"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
