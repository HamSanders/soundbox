/**
 * A sound's details as an artifact panel that slides in from the right.
 *
 * The body is `SoundArtifact`, the same panel the Studio shows beside its
 * timeline: waveform editor, stems and generation details. Here it floats
 * over the page as a third panel of the shell, with the same 8px margins,
 * stopping above the player.
 *
 * Non-modal on purpose: the list stays live behind it, so clicking another
 * row swaps what the panel shows and the player keeps working. Clicks on the
 * player do not count as "outside" and leave it open.
 */


import { SoundArtifact } from "@/components/sound-artifact";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PLAYER_DOCK_HEIGHT_PX } from "@/components/player-dock";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";
import { useDetailStore } from "@/lib/detail-store";
import { usePlayerStore } from "@/lib/player-store";

export function SoundDetailPanel() {
  const sound = useDetailStore((s) => s.sound);
  const close = useDetailStore((s) => s.close);
  const playing = usePlayerStore((s) => s.sound !== null);

  return (
    <Sheet open={sound !== null} onOpenChange={(o) => !o && close()} modal={false}>
      <SheetContent
        side="right"
        className="ring-border gap-0 border-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md data-[side=right]:md:top-2 data-[side=right]:md:right-2 data-[side=right]:md:h-auto md:rounded-xl md:ring-1 md:shadow-none"
        style={{ bottom: playing ? PLAYER_DOCK_HEIGHT_PX + 8 : 8 }}
        onInteractOutside={(e) => {
          const t = e.target as Element | null;
          // The player and the rows that feed this panel are not "outside".
          if (t?.closest('[aria-label="Now playing"], [data-sound-row]')) e.preventDefault();
        }}
      >
        {sound && (
          <>
            <div className="border-border grid gap-1 border-b px-4 pt-4 pb-3 pr-12">
              <SheetTitle className="font-display truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase">
                {sound.name}
              </SheetTitle>
              <SheetDescription className="readout text-muted-foreground truncate">
                {sound.seed != null ? `No. ${sound.seed} · ` : ""}
                {formatDuration(sound.duration_s)} · {formatBytes(sound.size_bytes)} ·{" "}
                {formatRelative(sound.created_at)}
              </SheetDescription>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <SoundArtifact sound={sound} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
