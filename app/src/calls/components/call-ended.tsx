import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

import { clock } from "../prefs";
import type { EndedInfo } from "../use-call";

const REASONS: Record<string, string> = {
  dropped: "The connection dropped.",
  lapsed: "The call timed out.",
  ended: "The call was ended by the server.",
  replaced: "This call continued in another tab.",
  error: "The call stopped with an error.",
};

/**
 * The "call ended" screen: the mic and audio are off, you stay where you were,
 * with a summary and two ways out (ported from the spike's ended.js).
 */
export function CallEnded({ who, photo, info, onAgain, onHome }: {
  who: string; photo?: string | null; info: EndedInfo; onAgain: () => void; onHome: () => void;
}) {
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus(), []);
  const last = info.last.length > 220 ? info.last.slice(0, 220).trimEnd() + "…" : info.last;
  return (
    <div
      role="dialog"
      aria-label="Call ended"
      className="fixed inset-0 z-50 grid place-items-center bg-background/90 px-5 py-6 backdrop-blur-sm animate-in fade-in duration-500"
    >
      <div className="grid w-full max-w-[560px] justify-items-start gap-5">
        <div className="flex items-center gap-3.5">
          {photo ? <img alt="" src={photo} className="size-16 rounded-full border border-border object-cover" /> : null}
          <span className="font-log text-sm text-muted-foreground">
            call with {who} · {clock(info.seconds)}
            {info.replies ? ` · ${info.replies} ${info.replies === 1 ? "reply" : "replies"}` : ""}
          </span>
        </div>
        <h2 className="font-display text-[clamp(48px,9vw,96px)] leading-[.88] font-extrabold uppercase tracking-wide">Call ended.</h2>
        {REASONS[info.reason] ? <p className="text-sm text-muted-foreground">{REASONS[info.reason]}</p> : null}
        {last ? <blockquote className="max-w-[46ch] border-l-2 border-border-strong pl-3.5 text-[17px] leading-snug text-muted-foreground">{last}</blockquote> : null}
        <div className="flex flex-wrap gap-2.5">
          <Button ref={again} size="lg" className="h-12 px-6 text-base" onClick={onAgain}>Call {who} again</Button>
          <Button variant="outline" size="lg" className="h-12 px-6 text-base" onClick={onHome}>Back to start</Button>
        </div>
      </div>
    </div>
  );
}
