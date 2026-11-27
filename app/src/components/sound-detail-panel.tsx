/**
 * A sound's details in the docked panel (see detail-dock.tsx).
 *
 * The body is `SoundArtifact`, the panel the Studio shows beside its
 * timeline: waveform editor, stems and generation details. The name is
 * edited where it's shown.
 */

import { XIcon } from "lucide-react";

import { DockFrame } from "@/components/dock-frame";
import { SoundArtifact } from "@/components/sound-artifact";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";
import type { Sound } from "@/lib/api";
import { useDock } from "@/lib/dock";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";
import { useSound, useUpdateSound } from "@/lib/queries";

export function SoundDetailPanel({ id }: { id: string }) {
  const close = useDock((s) => s.close);
  const seed = useDock((s) => s.seed) as Sound | null;
  const query = useSound(id);
  // The row that opened the panel had the whole sound: draw it at once, and
  // take the server's copy as soon as it comes.
  const sound = query.data ?? (seed?.id === id ? seed : null);
  const update = useUpdateSound();

  if (!sound) {
    return (
      <DockFrame label="Sound details" widthId="sound-detail" itemKey={`sound:${id}`}>
        <div className="border-border flex items-start gap-2 border-b px-4 pt-4 pb-3">
          <div className="grid flex-1 gap-2">
            {query.isError ? (
              <p className="text-sm">This sound is gone. It may have been deleted.</p>
            ) : (
              <>
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={close}>
            <XIcon />
          </Button>
        </div>
      </DockFrame>
    );
  }

  return (
    <DockFrame label={`Details for ${sound.name}`} widthId="sound-detail" itemKey={`sound:${id}`}>
      <div className="border-border flex items-start gap-2 border-b px-4 pt-4 pb-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <InlineEdit
            as="h2"
            value={sound.name}
            label="Sound name"
            onCommit={(name) => update.mutateAsync({ id: sound.id, patch: { name } })}
            className="font-display min-w-0 truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase"
          />
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
    </DockFrame>
  );
}
