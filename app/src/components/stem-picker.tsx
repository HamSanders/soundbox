/**
 * Choosing which stems come out of a split.
 *
 * Splitting is a destructive-feeling action with a slow middle: a minute of
 * separation, then four new sounds whether or not you wanted four. Both
 * surfaces that can start one — the Library card and the studio timeline —
 * ask the same two questions here rather than each growing their own form,
 * because the answers mean the same thing in both places and the second one
 * is easy to get wrong: what happens to the stems you did *not* pick.
 *
 * The names offered are the usual four (`COMMON_STEM_NAMES`). What a
 * separator actually writes is up to its loader family, so a selection is
 * matched loosely on the server and anything it cannot find is reported
 * rather than silently dropped — see `server/src/stems.ts`.
 */

import { useEffect, useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InstrumentBadge } from "@/components/instrument-badge";
import { LoadingVerb } from "@/components/loading-verb";
import { COMMON_STEM_NAMES, type StemSelection } from "@/lib/api";
import { cn } from "@/lib/utils";

export function StemPickerDialog({
  open,
  onOpenChange,
  title = "Split into stems",
  description,
  stems = COMMON_STEM_NAMES,
  confirmLabel = "Split",
  busy = false,
  onConfirm,
  secondaryLabel,
  onSecondary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** What the kept stems become on this surface — new library sounds, new
   *  lanes — which is the part that differs between callers. */
  description: string;
  stems?: string[];
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (selection: StemSelection) => void;
  /** A second way to finish with the same answers, for a surface with two
   *  destinations: the sound page splits into the library, or splits and
   *  lays the stems out in the studio. Shown only when both are given. */
  secondaryLabel?: string;
  onSecondary?: (selection: StemSelection) => void;
}) {
  const [picked, setPicked] = useState<string[]>(stems);
  const [rest, setRest] = useState<"discard" | "merge">("discard");

  // Back to everything each time it opens: a picker that remembers last
  // time's choice would silently throw away three stems on the next split.
  useEffect(() => {
    if (open) {
      setPicked(stems);
      setRest("discard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <StemChoice
          stems={stems}
          picked={picked}
          onPicked={setPicked}
          rest={rest}
          onRest={setRest}
        />

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {secondaryLabel && onSecondary && (
            <Button
              variant="outline"
              disabled={busy || picked.length === 0}
              onClick={() => onSecondary(toSelection(picked, rest, stems))}
            >
              {secondaryLabel}
            </Button>
          )}
          <Button
            disabled={busy || picked.length === 0}
            onClick={() => onConfirm(toSelection(picked, rest, stems))}
          >
            {busy && <Loader2Icon className="animate-spin" />}
            {busy ? <LoadingVerb /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A selection, as the API wants it.
 *
 * Everything picked is sent as "no choice at all" rather than as a list of
 * four names: a separator whose stems are called something else should still
 * hand back all of them, not nothing.
 */
export function toSelection(
  picked: string[],
  rest: "discard" | "merge",
  stems: string[] = COMMON_STEM_NAMES,
): StemSelection {
  return { keep: picked.length === stems.length ? [] : picked, rest };
}

/**
 * The two questions themselves, without the dialog around them.
 *
 * Shared so the composer can ask them inline — "split what this renders" is
 * the same choice as "split this clip", and a second set of chips that drifted
 * from these would be two vocabularies for one feature.
 */
export function StemChoice({
  stems = COMMON_STEM_NAMES,
  picked,
  onPicked,
  rest,
  onRest,
  className,
}: {
  stems?: string[];
  picked: string[];
  onPicked: (picked: string[]) => void;
  rest: "discard" | "merge";
  onRest: (rest: "discard" | "merge") => void;
  className?: string;
}) {
  const all = picked.length === stems.length;
  const toggle = (name: string): void =>
    onPicked(picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-2">
        {stems.map((name) => {
          const on = picked.includes(name);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(name)}
              className={cn(
                "border-border flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm capitalize transition-colors",
                on ? "border-primary/60 bg-primary/10" : "hover:bg-accent",
              )}
            >
              <InstrumentBadge stemName={name} className="size-6 rounded" iconClassName="size-3.5" />
              <span className="flex-1 truncate">{name}</span>
              {on && <CheckIcon className="text-primary size-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Only a question when something was left behind. With everything
          picked there is no "rest" to have an opinion about. */}
      {!all && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">The stems you didn&rsquo;t pick</p>
          <div className="flex gap-2">
            <RestOption
              on={rest === "discard"}
              onClick={() => onRest("discard")}
              label="Scrap them"
              hint="Never written. Only what you picked comes back."
            />
            <RestOption
              on={rest === "merge"}
              onClick={() => onRest("merge")}
              label="Keep as one"
              hint="Summed into a “rest” track — the original minus what you took out."
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RestOption({
  on,
  onClick,
  label,
  hint,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "border-border flex-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
        on ? "border-primary/60 bg-primary/10" : "hover:bg-accent",
      )}
    >
      <span className="block text-sm">{label}</span>
      <span className="text-muted-foreground block text-[11px] leading-snug">{hint}</span>
    </button>
  );
}
