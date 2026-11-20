/**
 * A voice's picture, wherever a voice is named.
 *
 * Its own module rather than a member of `voice-shared.tsx` because of who
 * needs it: the composer's voice pill, the script's speaker chip, the
 * timeline's clips and the Lab's pickers all want the 16px version, and
 * `voice-shared` pulls in the recorder, the add-voice dialog and `SoundCard`
 * behind it. A leaf that every surface can import is the point — a voice
 * should look the same in a popover as it does on its own card.
 */

import { useState } from "react";

import { useVoices } from "@/lib/queries";
import type { Voice } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A voice's avatar, or its initial.
 *
 * The fallback is a letter, in the display face, on a flat paper tile rather than a generic person
 * glyph: at 40px a stock silhouette is indistinguishable between rows, while
 * an initial is the one thing that already differs per voice. It is also the
 * same fallback `MusicCover` uses, so absent artwork looks deliberate across
 * the app rather than broken in two different ways.
 *
 * `artwork` is optional on the wire, so a server that predates this renders
 * initials everywhere instead of erroring.
 *
 * Size and radius come from `className` (`size-10 rounded-lg` by default, the
 * card size) so the same component covers a 40px card tile and a 16px pill
 * without a variant prop: both branches run the override through `cn`, which
 * is tailwind-merge, so a passed `size-4` genuinely replaces `size-10` rather
 * than losing to source order.
 */
export function VoiceAvatar({
  voice,
  className,
}: {
  voice: Pick<Voice, "name" | "artwork">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!voice.artwork || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "bg-muted text-foreground/70 font-display flex size-10 shrink-0 items-center justify-center rounded-lg text-base leading-none font-extrabold uppercase",
          className,
        )}
      >
        {voice.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={voice.artwork}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-10 shrink-0 rounded-lg object-cover", className)}
    />
  );
}

/**
 * The saved voice behind an id, or null.
 *
 * For the surfaces that hold a `voice_id` and not a `Voice` — a timeline clip,
 * a docked sample, a library row. One shared query, so a screen full of them
 * costs one fetch; a voice that has since been deleted resolves to null and
 * the caller falls back to whatever it showed before avatars existed.
 */
export function useVoice(voiceId: string | null | undefined): Voice | null {
  const { data } = useVoices();
  if (!voiceId) return null;
  return data?.find((v) => v.id === voiceId) ?? null;
}
