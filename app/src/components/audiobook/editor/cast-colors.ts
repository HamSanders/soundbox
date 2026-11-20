/**
 * One colour per voice across the editor. The narrator is index 0; each
 * character carries its own index (`Character.color`). Colours come from the
 * lane palette, which is themed for light and dark in `index.css`.
 */

import type { Character } from "@/lib/audiobook-types";
import { laneColor } from "@/lib/lanes";

export const NARRATOR_COLOR = 0;

export function castColor(index: number, alpha = 1): string {
  return laneColor(index, alpha);
}

export function characterById(characters: Character[], id: string | null): Character | null {
  return id ? (characters.find((c) => c.id === id) ?? null) : null;
}
