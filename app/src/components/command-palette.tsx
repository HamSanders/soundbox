/**
 * A filterable list of commands, over the page.
 *
 * The studio has six panels that can each be open or shut, and three ways to
 * say so: the Panels menu, a keyboard shortcut per panel, and this. They exist
 * for different moments rather than out of indecision — the menu is for when
 * you are already reading the toolbar, the shortcuts are for when you know
 * exactly what you want, and this is for when you know the *name* but not the
 * key, which is most of the time until a shortcut is in your fingers.
 *
 * Deliberately not a `cmdk` dependency. What a palette needs over a plain list
 * is a filter, arrow keys, and Enter — about forty lines — and the alternative
 * is a package whose styling has to be argued back into this app's own.
 *
 * The commands themselves are passed in. This component knows how to choose
 * one and nothing about what any of them do.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Keys } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export interface Command {
  id: string;
  label: string;
  /** A second line under the label: the model a sound was made with, the
   *  builder a story opens in. Searched as well as shown. */
  detail?: string;
  /** Words the filter should also match, beyond the label and detail — a
   *  sound's prompt, a setting's old name. Never shown. */
  keywords?: string;
  /** Rows with the same group render under one heading, in the order the
   *  group first appears. Ungrouped rows come first. */
  group?: string;
  /** Searchable but kept out of the default list — settings rows, say, which
   *  would otherwise bury the pages and the actions under twenty entries. */
  hidden?: boolean;
  /** The shortcut that also runs it, as keys ("mod" for the platform's
   *  modifier). Shown on the right so the palette teaches the keys rather
   *  than replacing them. */
  hint?: string[];
  /** Rendered as a check. For commands that toggle something, so the list
   *  reads as state rather than as a menu of verbs. */
  active?: boolean;
  /** Commands that cannot apply right now are shown and refused rather than
   *  hidden — a Prompt panel that vanishes from the list in a scripted story
   *  reads as a bug, where a greyed one reads as an answer. */
  disabled?: boolean;
  run: () => void;
}

/** The nearest selectable row from `from`, walking in `step`. Null when there
 *  is none that way, which is how the caller knows to try the other. */
function nextEnabled(commands: Command[], from: number, step: 1 | -1): number | null {
  for (let i = from + step; i >= 0 && i < commands.length; i += step) {
    if (!commands[i]?.disabled) return i;
  }
  return null;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = "Search panels…",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Every opening starts from a clean filter. A palette that remembers the
  // last thing you typed makes the second use a delete-first exercise.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.filter((c) => !c.hidden);
    // Every word typed must appear somewhere in the row: "ada voice" finds
    // the voice called Ada without also listing every sound she has read.
    const words = needle.split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      const hay = `${c.label} ${c.detail ?? ""} ${c.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [commands, query]);

  // Clamp rather than reset: typing narrows the list under a selection that
  // may now be past its end, and snapping back to the top on every keystroke
  // makes the highlight impossible to aim.
  //
  // Then walk off any disabled row. The first command in the list is routinely
  // one that does not apply — Script, in an arrangement — and leaving the
  // highlight parked there means opening the palette and pressing Enter does
  // nothing at all, with nothing on screen explaining why.
  const clamped = Math.min(index, Math.max(0, matches.length - 1));
  const selected = matches[clamped]?.disabled
    ? (nextEnabled(matches, clamped, 1) ?? nextEnabled(matches, clamped, -1) ?? clamped)
    : clamped;

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (command: Command | undefined): void => {
    if (!command || command.disabled) return;
    command.run();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* Required for the dialog to be announced, but the input's own
            placeholder is the visible label — a heading above a one-line
            search box is a heading nobody reads. */}
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <Input
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-11 rounded-none border-0 border-b focus-visible:ring-0"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex(nextEnabled(matches, selected, 1) ?? selected);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(nextEnabled(matches, selected, -1) ?? selected);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(matches[selected]);
            }
          }}
        />
        <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
          {matches.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">No matches.</p>
          ) : (
            matches.map((command, i) => (
              <div key={command.id} className="contents">
              {command.group && (i === 0 || matches[i - 1]?.group !== command.group) && (
                <p className="label-caps text-muted-foreground px-3 pt-2 pb-1">
                  {command.group}
                </p>
              )}
              <button
                type="button"
                data-index={i}
                disabled={command.disabled}
                // Pointer *down*, not click: the input holds focus, and a
                // click would blur it first and close the dialog underneath
                // the press on some browsers.
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(command);
                }}
                onPointerEnter={() => !command.disabled && setIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm disabled:opacity-40",
                  i === selected && !command.disabled && "bg-accent text-accent-foreground",
                )}
              >
                <span
                  className={cn("w-3 shrink-0 text-xs", !command.active && "opacity-0")}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{command.label}</span>
                  {command.detail && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {command.detail}
                    </span>
                  )}
                </span>
                {command.hint && <Keys keys={command.hint} className="shrink-0" />}
              </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
