/**
 * The app's fixed bottom player — `PlayerDock` (see `player-dock.tsx`), the
 * same dock `/music/:slug` uses, wired to the player store instead of a
 * hardcoded track.
 *
 * Opened by clicking a sound's title or cover tile in the Library (see
 * `sound-card.tsx`) rather than its own inline waveform — the row's compact
 * player is a quick local preview, this is "play it and keep it on screen
 * while I go do something else". The shared `playingId` in the player store
 * keeps the two from both being audible at once (see the "somebody else took
 * over" effect in `waveform-player.tsx`).
 *
 * `key={sound.id}` forces a remount on every new sound so `autoPlay` fires
 * again — `WaveformPlayer` only starts playback on mount, by design.
 */

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PlayerDock } from "@/components/player-dock";
import { WaveformPlayer } from "@/components/waveform-player";
import { usePlayerStore } from "@/lib/player-store";

export function NowPlayingBar() {
  const sound = usePlayerStore((s) => s.sound);
  const setSound = usePlayerStore((s) => s.setSound);
  const stop = usePlayerStore((s) => s.stop);

  if (!sound) return null;

  return (
    <PlayerDock
      position="fixed"
      ground
      title={sound.name}
      player={<WaveformPlayer key={sound.id} sound={sound} autoPlay />}
      trailing={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close player"
          onClick={() => {
            stop(sound.id);
            setSound(null);
          }}
        >
          <XIcon />
        </Button>
      }
    />
  );
}
