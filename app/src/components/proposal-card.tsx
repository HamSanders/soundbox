/**
 * The agent proposes, the person decides.
 *
 * One card for any change an assistant or agent wants to make, wherever it
 * shows: in the assistant thread beside a studio or a book, and later in the
 * activity feed or inline where the change will land. Lifted out of the
 * assistant's old `EditsCard` so every area says "this is what will happen"
 * the same way (docs/redesign-2026-11/dialogs-and-forms-audit.md, §6.4).
 *
 * - `proposed`: Accept (primary), Reject, and Tweak when there's somewhere
 *   to tweak it. A batch gets Accept and Reject per row as well, plus
 *   Accept all. Microsoft's Human-AI guidelines ask for efficient dismissal
 *   and efficient correction (G8, G9,
 *   https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/), and VS
 *   Code's Copilot edits are kept or undone per change or all at once
 *   (https://code.visualstudio.com/docs/copilot/chat/review-code-edits).
 * - `applied`: a receipt, with Undo when the change has an inverse.
 * - `risk="destructive"`: the deleting rows are red and the accept button is
 *   the destructive one. Nothing destructive is applied without a click.
 */

import type { ReactNode } from "react";
import {
  CheckIcon,
  CircleDashedIcon,
  Loader2Icon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ProposalStatus = "proposed" | "applying" | "applied" | "rejected" | "failed" | "undone";
export type ProposalRisk = "safe" | "costly" | "destructive";

export interface ProposalItem {
  id: string;
  label: ReactNode;
  /** A second line: what a value is, or why it failed. */
  detail?: ReactNode;
  /** Per-row state, for a batch accepted or failing one row at a time. */
  status?: ProposalStatus;
  /** `destructive` rows are red; `muted` ones are context, not changes. */
  tone?: "default" | "muted" | "destructive";
  /** A short tag after the label, e.g. "voices audio". */
  badge?: string;
}

const STATUS_ICON: Record<ProposalStatus, ReactNode> = {
  proposed: <CircleDashedIcon className="text-muted-foreground size-3.5" aria-hidden="true" />,
  applying: <Loader2Icon className="text-muted-foreground size-3.5 animate-spin" aria-hidden="true" />,
  applied: <CheckIcon className="text-ok size-3.5" aria-hidden="true" />,
  rejected: <XIcon className="text-muted-foreground size-3.5" aria-hidden="true" />,
  failed: <TriangleAlertIcon className="text-destructive size-3.5" aria-hidden="true" />,
  undone: <RotateCcwIcon className="text-muted-foreground size-3.5" aria-hidden="true" />,
};

const STATUS_WORD: Record<ProposalStatus, string> = {
  proposed: "Proposed",
  applying: "Running",
  applied: "Done",
  rejected: "Rejected",
  failed: "Failed",
  undone: "Undone",
};

export function ProposalCard({
  title,
  summary,
  items,
  risk = "safe",
  status,
  receipt,
  acceptLabel,
  onAccept,
  onReject,
  onTweak,
  onUndo,
  undoNote,
  onAcceptItem,
  onRejectItem,
  onOpen,
  openLabel,
  waitingNote,
  className,
}: {
  title?: ReactNode;
  summary?: ReactNode;
  items: ProposalItem[];
  risk?: ProposalRisk;
  status: ProposalStatus;
  /** The applied line, e.g. "Applied to the studio, Ctrl+Z there undoes it". */
  receipt?: ReactNode;
  acceptLabel?: string;
  /** Null when there is nothing to apply to any more; the card says why in
   *  `waitingNote`. */
  onAccept?: (() => void) | null;
  onReject?: () => void;
  onTweak?: () => void;
  /** Shown once applied, when the change has an inverse. */
  onUndo?: (() => void) | null;
  /** Why Undo isn't offered, or covers only part of it. */
  undoNote?: ReactNode;
  onAcceptItem?: (id: string) => void;
  onRejectItem?: (id: string) => void;
  /** Make the whole card a way back to where the change landed. */
  onOpen?: (() => void) | null;
  openLabel?: string;
  waitingNote?: ReactNode;
  className?: string;
}) {
  const proposed = status === "proposed";
  const batch = items.length > 1 && proposed && onAcceptItem !== undefined;
  const openable = Boolean(onOpen) && status === "applied";
  const destructive = risk === "destructive";

  const header =
    status === "applied" ? (
      <>
        <CheckIcon className="text-ok size-3.5" aria-hidden="true" />
        {receipt ?? "Done"}
      </>
    ) : status === "applying" ? (
      <>
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        Working…
      </>
    ) : status === "rejected" ? (
      <>
        <XIcon className="size-3.5" aria-hidden="true" />
        Rejected, nothing was changed
      </>
    ) : status === "undone" ? (
      <>
        <RotateCcwIcon className="size-3.5" aria-hidden="true" />
        Undone
      </>
    ) : status === "failed" ? (
      <>
        <TriangleAlertIcon className="text-destructive size-3.5" aria-hidden="true" />
        Something didn't go through
      </>
    ) : destructive ? (
      <>
        <TriangleAlertIcon className="text-destructive size-3.5" aria-hidden="true" />
        Waiting for you: this deletes something
      </>
    ) : (
      <>
        <CircleDashedIcon className="size-3.5" aria-hidden="true" />
        {risk === "costly" ? "Waiting for you: this makes audio" : "Waiting for you"}
      </>
    );

  return (
    <div
      className={cn(
        "border-border bg-card rounded-xl border p-3 shadow-sm",
        openable && "hover:border-foreground/25 cursor-pointer transition-colors",
        className,
      )}
      {...(openable
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": openLabel,
            onClick: () => onOpen?.(),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.();
              }
            },
          }
        : {})}
    >
      <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium" aria-live="polite">
        {header}
      </p>
      {title && <p className="mb-1 text-sm font-medium">{title}</p>}
      {summary && <p className="text-muted-foreground mb-1.5 text-xs">{summary}</p>}
      <ul className="space-y-1 text-xs">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-1.5">
            {items.length > 1 || item.status ? (
              <span className="mt-px shrink-0" title={STATUS_WORD[item.status ?? status]}>
                {STATUS_ICON[item.status ?? status]}
                <span className="sr-only">{STATUS_WORD[item.status ?? status]}: </span>
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "break-words",
                  item.tone === "destructive" ? "text-destructive" : item.tone === "muted" ? "text-muted-foreground" : "text-foreground",
                  (item.status === "rejected" || item.status === "undone") && "line-through opacity-70",
                )}
              >
                {item.label}
              </span>
              {item.badge && (
                <span className="bg-muted text-muted-foreground ml-1.5 rounded px-1 py-px text-[10px] whitespace-nowrap">
                  {item.badge}
                </span>
              )}
              {item.detail && <span className="text-muted-foreground block break-words">{item.detail}</span>}
            </span>
            {batch && item.status === "proposed" && (
              <span className="flex shrink-0 gap-0.5">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Accept this one"
                  title="Accept this one"
                  disabled={!onAccept}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcceptItem?.(item.id);
                  }}
                >
                  <CheckIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Reject this one"
                  title="Reject this one"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRejectItem?.(item.id);
                  }}
                >
                  <XIcon />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {openable && openLabel && <p className="text-muted-foreground mt-2 text-[11px]">Click to {openLabel.charAt(0).toLowerCase() + openLabel.slice(1)}.</p>}
      {proposed && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {onAccept ? (
            <Button
              size="sm"
              variant={destructive ? "destructive" : "default"}
              onClick={(e) => {
                e.stopPropagation();
                onAccept();
              }}
            >
              {acceptLabel ?? (batch ? "Accept all" : "Accept")}
            </Button>
          ) : (
            waitingNote && <p className="text-muted-foreground text-xs">{waitingNote}</p>
          )}
          {onTweak && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onTweak();
              }}
            >
              Tweak
            </Button>
          )}
          {onReject && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
            >
              Reject
            </Button>
          )}
        </div>
      )}
      {(status === "applied" || status === "failed") && (onUndo || undoNote) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onUndo && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onUndo();
              }}
            >
              <Undo2Icon />
              Undo
            </Button>
          )}
          {undoNote && <p className="text-muted-foreground text-[11px]">{undoNote}</p>}
        </div>
      )}
    </div>
  );
}
