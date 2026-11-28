/**
 * The one way a failed generation or download is shown.
 *
 * A title that says what happened, a hint that says why, what to do and what
 * is kept, up to two fix chips that link into the app, Retry when a retry
 * could help, the raw text under Details, and Copy diagnostic for a bug
 * report. The server builds the `Failure` (see `server/src/failure.ts`); an
 * error that arrived as a bare string still gets the same card, with the
 * string as its title and nothing hidden.
 *
 * Toasts are for confirmations ("Copied", "Stems ready"). A failure that
 * belongs to a workflow renders here, inline, where the thing that failed
 * was, so it can be read, acted on and dismissed rather than fading away.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, OctagonXIcon, RotateCcwIcon, XIcon } from "@/lib/icons";

import { Button } from "@/components/ui/button";
import type { Failure } from "@/lib/api";
import { diagnosticText, failureFromError } from "@/lib/failure";
import { cn } from "@/lib/utils";

export function FailureCard({
  failure,
  error,
  context,
  onRetry,
  onDismiss,
  retryLabel = "Retry",
  compact = false,
  className,
}: {
  /** The classified failure. When null, `error` is shown on its own. */
  failure?: Failure | null;
  /** The plain message, for callers that only have that. */
  error?: string | null;
  /** What was being done: the prompt, the model's name. One line. */
  context?: string | null;
  /** Shown as a button unless the failure is terminal (a retry with
   *  nothing changed would fail the same way). */
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
  /** Tighter padding for a row inside a list. */
  compact?: boolean;
  className?: string;
}) {
  const f = failure ?? failureFromError(error);
  const [copied, setCopied] = useState(false);
  const detail = f.detail.trim();
  /** The raw text is only worth a disclosure when it says more than the title. */
  const hasDetails = detail.length > 0 && detail !== f.title;

  const copy = () => {
    void navigator.clipboard.writeText(diagnosticText(f, context)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      /* clipboard refused (permissions, insecure context): nothing to undo */
    });
  };

  return (
    <div
      role="alert"
      className={cn(
        "bg-danger/5 ring-danger/30 animate-in fade-in-0 rounded-xl ring-1 ring-inset duration-300",
        compact ? "px-3 py-2.5" : "px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <OctagonXIcon className="text-danger mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-medium leading-snug">{f.title}</p>
          {context && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs" title={context}>
              {context}
            </p>
          )}
          {f.hint && (
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">{f.hint}</p>
          )}

          {(f.fixes.length > 0 || (onRetry && !f.terminal)) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {onRetry && !f.terminal && (
                <Button type="button" size="sm" variant="secondary" className="h-7 rounded-full px-2.5 text-xs" onClick={onRetry}>
                  <RotateCcwIcon className="size-3.5" aria-hidden="true" />
                  {retryLabel}
                </Button>
              )}
              {f.fixes.slice(0, 2).map((fix) => (
                <Link
                  key={`${fix.to}:${fix.label}`}
                  to={fix.to}
                  className="bg-background/60 text-foreground ring-border hover:bg-muted inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset"
                >
                  {fix.label}
                  <ArrowUpRightIcon className="size-3" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {hasDetails && (
              <details className="min-w-0 flex-1 basis-full">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs select-none">
                  Details
                </summary>
                <pre className="text-muted-foreground mt-1.5 max-h-48 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {detail}
                </pre>
              </details>
            )}
            <button
              type="button"
              onClick={copy}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
              aria-label="Copy a diagnostic block for a bug report"
            >
              {copied ? (
                <CheckIcon className="size-3.5" aria-hidden="true" />
              ) : (
                <CopyIcon className="size-3.5" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy diagnostic"}
            </button>
          </div>
        </div>
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss this failure (the sound was not made)"
            onClick={onDismiss}
            className="text-muted-foreground -mt-1 -mr-1.5 size-7 shrink-0 rounded-full"
          >
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
