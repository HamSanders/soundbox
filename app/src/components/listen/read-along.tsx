/**
 * The book text, following the audio. The paragraph being read is
 * highlighted and kept in view, and inside it the current word (estimated,
 * see `listen-readalong.ts`). Tap any voiced paragraph to play from it.
 *
 * Scrolling by hand pauses the follow for a few seconds, with a button to jump
 * back to where the narrator is.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkIcon, LocateFixedIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { paragraphAt, useAudioClock, useListenPlayer } from "@/lib/listen-player-store";
import { wordAt, wordTimings } from "@/lib/listen-readalong";
import type { ListenParagraph } from "@/lib/listen-types";
import { cn } from "@/lib/utils";

const FOLLOW_PAUSE_MS = 4000;

function ActiveParagraph({ paragraph }: { paragraph: ListenParagraph }) {
  const words = useMemo(() => wordTimings(paragraph), [paragraph]);
  const t = useAudioClock();
  const current = wordAt(words, t);
  const text = paragraph.text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  words.forEach((w, i) => {
    if (w.offset > cursor) parts.push(text.slice(cursor, w.offset));
    parts.push(
      <span
        key={i}
        className={cn(
          "rounded-sm transition-colors duration-100",
          i === current && "bg-primary text-primary-foreground",
          i < current && "text-foreground",
        )}
      >
        {w.text}
      </span>,
    );
    cursor = w.offset + w.text.length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function ReadAlong({ className }: { className?: string }) {
  const manifest = useListenPlayer((s) => s.manifest);
  const chapterIndex = useListenPlayer((s) => s.chapterIndex);
  const position = useListenPlayer((s) => s.position);
  const seek = useListenPlayer((s) => s.seek);
  const play = useListenPlayer((s) => s.play);
  const chapter = manifest?.chapters[chapterIndex] ?? null;
  const active = paragraphAt(chapter, position);
  const scroller = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [heldUntil, setHeldUntil] = useState(0);
  const programmatic = useRef(false);

  const marked = useMemo(
    () => new Set((manifest?.bookmarks ?? []).filter((b) => b.chapter_id === chapter?.id).map((b) => b.segment_id)),
    [manifest?.bookmarks, chapter?.id],
  );

  const follow = () => {
    const el = refs.current[active];
    if (!el) return;
    programmatic.current = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => (programmatic.current = false), 600);
  };

  useEffect(() => {
    if (Date.now() < heldUntil) return;
    follow();
    // follow reads the latest refs; re-run only when the paragraph changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, chapter?.id]);

  if (!chapter) return null;
  const held = Date.now() < heldUntil;

  return (
    <div className={cn("relative min-h-0", className)}>
      <div
        ref={scroller}
        className="h-full overflow-y-auto px-1 py-[30vh]"
        onWheel={() => setHeldUntil(Date.now() + FOLLOW_PAUSE_MS)}
        onTouchMove={() => setHeldUntil(Date.now() + FOLLOW_PAUSE_MS)}
      >
        <div className="mx-auto max-w-2xl space-y-4">
          {chapter.paragraphs.map((p, i) => {
            const voiced = p.start_s !== null;
            return (
              <p
                key={p.segment_id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role={voiced ? "button" : undefined}
                tabIndex={voiced ? 0 : undefined}
                aria-current={i === active ? "true" : undefined}
                onClick={() => {
                  if (!voiced) return;
                  seek(p.start_s!);
                  play();
                  setHeldUntil(0);
                }}
                onKeyDown={(e) => {
                  if (voiced && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    seek(p.start_s!);
                    play();
                  }
                }}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-lg leading-relaxed transition-colors",
                  p.is_heading && "font-heading text-2xl font-semibold",
                  voiced ? "cursor-pointer hover:bg-accent/60" : "text-muted-foreground/60",
                  i === active ? "bg-accent text-muted-foreground" : i < active ? "text-muted-foreground" : "",
                )}
              >
                {marked.has(p.segment_id) && (
                  <BookmarkIcon className="text-primary absolute top-3 -left-4 size-3.5 fill-current" aria-label="Bookmarked" />
                )}
                {i === active ? <ActiveParagraph paragraph={p} /> : p.text}
              </p>
            );
          })}
        </div>
      </div>
      {held && active >= 0 && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            setHeldUntil(0);
            follow();
          }}
        >
          <LocateFixedIcon /> Back to narrator
        </Button>
      )}
    </div>
  );
}
