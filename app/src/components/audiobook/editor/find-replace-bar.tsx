/**
 * Find and replace across the book or the open chapter. Matches are counted
 * as you type (a dry run on the server) and highlighted in the chapter.
 * Locked paragraphs are never changed; the bar says how many were skipped.
 */

import { useEffect, useMemo, useState } from "react";
import { CaseSensitiveIcon, RegexIcon, WholeWordIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReplaceRequest, ReplaceResult } from "@/lib/audiobook-api";
import { useReplace } from "@/lib/audiobook-queries";
import { cn } from "@/lib/utils";

export interface FindOptions {
  find: string;
  case_sensitive: boolean;
  whole_word: boolean;
  regex: boolean;
}

/** The client-side pattern for highlighting; null when empty or invalid. */
function findPattern(o: FindOptions): RegExp | null {
  if (!o.find) return null;
  let source = o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (o.whole_word) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${o.case_sensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

function Toggle({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(on && "bg-primary/15 text-foreground")}
    >
      {children}
    </Button>
  );
}

export function FindReplaceBar({
  bookId,
  chapterId,
  onChange,
  onClose,
}: {
  bookId: string;
  chapterId: string | null;
  onChange: (pattern: RegExp | null) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<FindOptions>({
    find: "",
    case_sensitive: false,
    whole_word: false,
    regex: false,
  });
  const [replace, setReplace] = useState("");
  const [scope, setScope] = useState<"book" | "chapter">("book");
  const [preview, setPreview] = useState<ReplaceResult | null>(null);
  const [done, setDone] = useState<ReplaceResult | null>(null);
  const count = useReplace(bookId);
  const run = useReplace(bookId);

  const pattern = useMemo(() => findPattern(opts), [opts]);
  const edit = (next: FindOptions) => {
    setOpts(next);
    setDone(null);
    if (!next.find) setPreview(null);
  };
  const invalid = opts.find !== "" && pattern === null;

  useEffect(() => onChange(pattern), [pattern, onChange]);
  useEffect(() => () => onChange(null), [onChange]);

  const request = (dry: boolean): ReplaceRequest => ({
    ...opts,
    replace,
    dry_run: dry,
    chapter_ids: scope === "chapter" && chapterId ? [chapterId] : undefined,
  });

  // Live count, debounced.
  const countMutate = count.mutate;
  useEffect(() => {
    if (!opts.find || invalid) return;
    const t = setTimeout(
      () => countMutate({ ...opts, replace: "", dry_run: true, chapter_ids: scope === "chapter" && chapterId ? [chapterId] : undefined }, { onSuccess: setPreview }),
      250,
    );
    return () => clearTimeout(t);
  }, [opts, scope, chapterId, invalid, countMutate]);

  const summary = done
    ? `Replaced ${done.matches} in ${done.paragraphs} paragraph${done.paragraphs === 1 ? "" : "s"}` +
      (done.skipped_locked ? `. ${done.skipped_locked} locked left alone.` : ".")
    : invalid
      ? "Invalid pattern"
      : preview && opts.find
        ? `${preview.matches} match${preview.matches === 1 ? "" : "es"} in ${preview.paragraphs} paragraph${preview.paragraphs === 1 ? "" : "s"}` +
          (preview.skipped_locked ? ` (+${preview.skipped_matches} in locked)` : "")
        : "";

  return (
    <div
      className="border-border/70 bg-card flex flex-wrap items-center gap-2 border-b px-3 py-2"
      role="search"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center gap-0.5">
        <Input
          autoFocus
          value={opts.find}
          placeholder="Find"
          aria-label="Find"
          aria-invalid={invalid}
          className="h-7 w-48 text-sm"
          onChange={(e) => edit({ ...opts, find: e.target.value })}
        />
        <Toggle label="Match case" on={opts.case_sensitive} onClick={() => edit({ ...opts, case_sensitive: !opts.case_sensitive })}>
          <CaseSensitiveIcon />
        </Toggle>
        <Toggle label="Whole word" on={opts.whole_word} onClick={() => edit({ ...opts, whole_word: !opts.whole_word })}>
          <WholeWordIcon />
        </Toggle>
        <Toggle label="Regular expression" on={opts.regex} onClick={() => edit({ ...opts, regex: !opts.regex })}>
          <RegexIcon />
        </Toggle>
      </div>
      <Input
        value={replace}
        placeholder="Replace with"
        aria-label="Replace with"
        className="h-7 w-48 text-sm"
        onChange={(e) => setReplace(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && opts.find && !invalid) run.mutate(request(false), { onSuccess: setDone });
        }}
      />
      <select
        value={scope}
        aria-label="Scope"
        onChange={(e) => setScope(e.target.value as "book" | "chapter")}
        className="border-input bg-card h-7 rounded-md border px-2 text-xs"
      >
        <option value="book">Whole book</option>
        <option value="chapter">This chapter</option>
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!opts.find || invalid || run.isPending || (preview?.matches ?? 0) === 0}
        onClick={() => run.mutate(request(false), { onSuccess: setDone })}
      >
        Replace all
      </Button>
      <span className={cn("text-muted-foreground text-xs", invalid && "text-danger")} aria-live="polite">
        {summary}
      </span>
      <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Close find and replace" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
