/**
 * One filter as a rounded dropdown, for the filter rows on Audiobooks,
 * Listen and Explore. A chip that's set to something other than its first
 * ("All …") option is drawn filled, so you can see at a glance what's on.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FilterChip<T extends string>({
  label,
  value,
  onChange,
  options,
  width = "w-40",
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  width?: string;
}) {
  const active = options.length > 0 && value !== options[0]!.value;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger
        size="sm"
        className={cn(width, "rounded-full", active && "border-foreground/40 bg-accent text-foreground")}
        aria-label={label}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
