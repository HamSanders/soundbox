/**
 * Icons for separated stems, drawn rather than generated.
 *
 * A stem's instrument is a closed set — htdemucs emits vocals/drums/bass/other,
 * and the wider audio.cpp separators add guitar and piano — so this is a lookup,
 * not a generation. Three reasons it stays that way, all of which the image
 * model loses on:
 *
 *   - It works with artwork turned off, which is the default. A stem list that
 *     only had icons for users who downloaded a diffusion model would be a
 *     stem list nobody sees icons in.
 *   - It is identical every time. Two renders of "drums" from a diffusion model
 *     are two different drum kits, and a list where the same stem type looks
 *     different per row reads as noise.
 *   - It costs nothing. These are inline SVG paths; the alternative is seconds
 *     of GPU time and a megabyte on disk per stem.
 *
 * Everything here is stroke-based and inherits `currentColor`, so it themes
 * with the rest of the UI instead of carrying baked-in light-mode pixels.
 */

import {
  AudioLinesIcon,
  DiscIcon,
  GuitarIcon,
  MicVocalIcon,
  MusicIcon,
  PianoIcon,
  RadioIcon,
  type LucideIcon,
} from "@/lib/icons";

/**
 * Stem name → icon. Matched on substrings rather than equality: separators
 * label the same thing differently ("vocals", "vocal", "voice"), and the app
 * also shows these for tracks whose name merely mentions an instrument.
 *
 * Order matters — the first match wins, so the specific patterns sit above the
 * general ones. "bass" before "bass drum" would be wrong for a drum kit, which
 * is why "drum" is checked first.
 */
const MATCHERS: { patterns: string[]; icon: LucideIcon; label: string }[] = [
  { patterns: ["drum", "percussion", "kick", "snare"], icon: DiscIcon, label: "Drums" },
  { patterns: ["vocal", "voice", "vox", "sing"], icon: MicVocalIcon, label: "Vocals" },
  { patterns: ["bass"], icon: AudioLinesIcon, label: "Bass" },
  { patterns: ["guitar", "gtr"], icon: GuitarIcon, label: "Guitar" },
  { patterns: ["piano", "keys", "keyboard", "synth"], icon: PianoIcon, label: "Keys" },
  { patterns: ["other", "residual", "accompaniment"], icon: RadioIcon, label: "Other" },
];

export interface InstrumentIcon {
  Icon: LucideIcon;
  /** A human label for the matched instrument, for `aria-label`/`title` — the
   *  raw stem name is often lowercase and abbreviated. */
  label: string;
  /** False when nothing matched and the generic note icon is standing in. The
   *  caller can use this to decide whether an unknown instrument is worth
   *  rendering an image for; see `instrumentPrompt` on the server. */
  matched: boolean;
}

export function instrumentIcon(stemName: string): InstrumentIcon {
  const name = stemName.toLowerCase();
  for (const entry of MATCHERS) {
    if (entry.patterns.some((p) => name.includes(p))) {
      return { Icon: entry.icon, label: entry.label, matched: true };
    }
  }
  return { Icon: MusicIcon, label: stemName, matched: false };
}
