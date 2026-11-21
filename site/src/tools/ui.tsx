/** Pieces the free tool pages share: the drop zone, a section block, the funnel. */

import { ArrowDownIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { DownloadButton } from "@/components/download-cta";
import { cn } from "@/lib/utils";

export const ACCEPT = "audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg";

export function DropZone({
  onFile,
  disabled,
  hint,
  compact,
}: {
  onFile: (f: File) => void;
  disabled?: boolean;
  hint: string;
  /** The smaller version that sits in a tool's create panel. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={cn(
        "border-border flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed text-center transition-colors",
        compact ? "bg-field px-4 py-8" : "px-6 py-12",
        over && "border-foreground bg-muted/40",
        !disabled && "hover:border-border-strong",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <UploadIcon className={cn("text-muted-foreground", compact ? "size-6" : "size-7")} aria-hidden="true" />
      <p className={cn("font-semibold tracking-tight", compact ? "text-sm" : "text-base")}>Drop a song here, or click to choose one</p>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function Block({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-border/60 scroll-mt-16 border-t px-4 py-16 sm:py-20">
      <div className="mx-auto w-full max-w-3xl">
        <p className="label-caps text-muted-foreground">{label}</p>
        <h2 id={`${id}-h`} className="mt-2 text-3xl sm:text-4xl">
          {title}
        </h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

/** The point of a free tool: what to do next. */
export function Funnel({ source, title, body }: { source: string; title: string; body: string }) {
  return (
    <div className="border-border mt-8 rounded-md border p-6 text-left">
      <p className="label-caps text-muted-foreground">Next</p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
      <div className="mt-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <DownloadButton pickerHref="/download" />
        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
          <a href={`https://cloud.mirli.app/?src=${source}`} className="hover:text-foreground underline underline-offset-4">
            No graphics card? Join the Mirli Cloud waitlist
          </a>
          <Link to="/mcp" className="hover:text-foreground underline underline-offset-4">
            Or do it from Claude, Cursor or your editor
          </Link>
        </div>
      </div>
    </div>
  );
}

export function DownloadLink({ href, name, label }: { href: string; name: string; label: string }) {
  return (
    <a href={href} download={name} className="text-sm font-medium underline underline-offset-4 inline-flex items-center gap-1">
      <ArrowDownIcon className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}

export function formatDuration(s: number): string {
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
