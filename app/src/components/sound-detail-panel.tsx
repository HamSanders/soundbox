/**
 * A sound's details as an artifact panel, docked to the right of the page.
 *
 * Like the Studio's artifact panels (or an artifact pane beside a chat), it
 * is a third panel of the shell rather than an overlay: it sits in the same
 * row as the sidebar and the page, with the same margins and 4px gutter,
 * and the page narrows to make room. The list stays live beside it, so
 * another row swaps what it shows and the player keeps working.
 *
 * The body is `SoundArtifact`, the panel the Studio shows beside its
 * timeline: waveform editor, stems and generation details. On a narrow
 * window there is no room beside the page, so it covers it instead.
 */

import { useEffect } from "react";
import { XIcon } from "lucide-react";

import { SoundArtifact } from "@/components/sound-artifact";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";
import { useDetailStore } from "@/lib/detail-store";

export function SoundDetailPanel() {
  const sound = useDetailStore((s) => s.sound);
  const close = useDetailStore((s) => s.close);

  useEffect(() => {
    if (!sound) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sound, close]);

  if (!sound) return null;

  return (
    <aside
      aria-label={`Details for ${sound.name}`}
      className="bg-background ring-border animate-in fade-in-0 slide-in-from-right-8 fixed inset-x-0 top-0 bottom-(--dock-h,0px) z-30 flex flex-col duration-(--duration-base) md:static md:z-auto md:my-2 md:mr-2 md:h-[calc(100svh-1rem-var(--dock-h,0px))] md:w-[26rem] md:shrink-0 md:rounded-xl md:ring-1"
    >
      <div className="border-border flex items-start gap-2 border-b px-4 pt-4 pb-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="font-display truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase">
            {sound.name}
          </h2>
          <p className="readout text-muted-foreground truncate">
            {sound.seed != null ? `No. ${sound.seed} · ` : ""}
            {formatDuration(sound.duration_s)} · {formatBytes(sound.size_bytes)} ·{" "}
            {formatRelative(sound.created_at)}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SoundArtifact key={sound.id} sound={sound} />
      </div>
    </aside>
  );
}
