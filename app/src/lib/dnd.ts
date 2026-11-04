/**
 * Dragging a sound out of the library and onto the timeline.
 *
 * A custom MIME type rather than `text/plain`, so a lane can tell "a sound
 * from this app" apart from any old text a browser will happily let you drop
 * on a page — the lane checks `dataTransfer.types` during dragover, and
 * anything else is refused before the pointer ever suggests it would land.
 *
 * `text/plain` carries the sound's name, both as a courtesy to other drop
 * targets and because the timeline labels the clip it creates with it.
 *
 * The rest of what a drop needs to know — how long the sound is, so it can
 * tell whether it fits where it landed — is kept here in a module variable
 * rather than in the drag payload. `DataTransfer` withholds its data until the
 * drop itself, so a lane cannot read it while deciding what the drop *would*
 * do; and this only has to survive a drag inside one page, which shares this
 * module with the library pane that started it.
 */

export const SOUND_DND_TYPE = "application/x-konchi-sound";

export interface SoundDrag {
  id: string;
  name: string;
  durationS: number;
}

let inFlight: SoundDrag | null = null;

export function setSoundDrag(event: React.DragEvent, sound: SoundDrag): void {
  event.dataTransfer.setData(SOUND_DND_TYPE, sound.id);
  event.dataTransfer.setData("text/plain", sound.name);
  event.dataTransfer.effectAllowed = "copy";
  inFlight = sound;
}

/** Cleared on `dragend`, which fires whether the drag was dropped or not. */
export function clearSoundDrag(): void {
  inFlight = null;
}

/** What is being dragged right now, readable mid-drag. */
export function currentSoundDrag(): SoundDrag | null {
  return inFlight;
}

/** The dragged sound's id, or null when the drag is carrying something else.
 *  Only readable on drop. */
export function getSoundDrag(event: React.DragEvent): string | null {
  return event.dataTransfer.getData(SOUND_DND_TYPE) || null;
}

export function isSoundDrag(event: React.DragEvent): boolean {
  // `types` is the only thing readable during dragover — the data itself is
  // withheld until the drop, which is why this check cannot just read the id.
  return event.dataTransfer.types.includes(SOUND_DND_TYPE);
}
