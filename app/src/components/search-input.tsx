/**
 * The search box every index page uses.
 *
 * This existed twice before it existed once: models.tsx grew a
 * `SearchFilterBar`, voice-lab.tsx copied its input verbatim, and the comment
 * there explained the copy as "keeps the two pages looking identical without
 * coupling them". That reasoning holds for the *filters* beside the box, which
 * are genuinely per-page — a model's category tabs mean nothing on a voice —
 * but not for the box itself, which was the same twenty lines in both.
 *
 * So only the box is shared. Each page keeps its own filter row and puts this
 * in it, which is what let Projects and Agents get search without a fourth
 * copy appearing.
 */

import { SearchIcon, XIcon } from "@/lib/icons";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Doubles as the accessible name — every caller's placeholder already
   *  reads as one ("Search voices…"), and a separate label would only be a
   *  chance for the two to disagree. */
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex-1", className)}>
      <SearchIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8"
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
          aria-label="Clear search"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
