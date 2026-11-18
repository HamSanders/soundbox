/**
 * The way out of a take: render it, and put it on the timeline.
 *
 * Shared by the MIDI panel and the piano roll rather than owned by either,
 * because a take can be finished from either one — you might play a phrase and
 * place it without ever opening the roll, or draw the whole thing in the roll
 * without touching the keyboard. An action that lived in only one panel would
 * make the other a dead end, which is exactly what it was before this existed.
 *
 * Everything it needs is in `midi-store` — the notes, the instrument, the
 * prompt, the strength — so both copies are the same controls over the same
 * state, not two forms that have to be kept in sync.
 */

import { useState } from "react";
import { WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { encodeWav } from "@/lib/audio-file";
import { INSTRUMENTS, notesDuration, renderNotes } from "@/lib/midi";
import { useMidiStore } from "@/lib/midi-store";
import { formatDuration } from "@/lib/format";

/** What to ask a model for, once the dry take is placed. */
export interface CoverRequest {
  prompt: string;
  /** 1 follows the source closely, 0 is loose. */
  strength: number;
}

export interface TakeActionsProps {
  /** Where the clip will land, for saying so before it does. */
  playheadS: number;
  /** Editing is shut while an agent is working the story — see StoryEditor. */
  readOnly?: boolean;
  /** Whether the installed catalogue can run a cover at all. Without one the
   *  take can only be placed dry, and the panel says why. */
  canCover?: boolean;
  /** Save the render as a sound and place it as a clip; `cover` additionally
   *  asks a model for the instrument. Neither panel knows how a story is
   *  written, or how a generation is submitted; the studio does. */
  onPlace: (wav: Blob, name: string, cover: CoverRequest | null) => Promise<void>;
  /** Held while a take is being played in — placing half a performance is not
   *  a thing anyone means to do. */
  busy?: boolean;
}

/**
 * Render the take and hand it over — the button's job, without the button.
 *
 * Extracted because the MIDI panel's mapping can now fire Place and Generate
 * from a pad, and a pad reaching into this component for its onClick would
 * mean an imperative handle threaded through two panels. Everything the work
 * needs is in the store already, so a second caller is a second call to this
 * hook rather than a ref.
 */
export function useTakePlacement(onPlace: TakeActionsProps["onPlace"]): {
  placing: boolean;
  place: (cover: CoverRequest | null) => Promise<void>;
} {
  const [placing, setPlacing] = useState(false);
  /** Read at call time, not render time: a pad-triggered place happens inside
   *  a listener bound once, and a captured `notes` would be the take as it
   *  was when the mapping was set up. */
  const place = async (cover: CoverRequest | null): Promise<void> => {
    const { notes, instrument } = useMidiStore.getState();
    if (!notes.length || placing) return;
    setPlacing(true);
    try {
      const buffer = await renderNotes(notes, instrument);
      const label = INSTRUMENTS.find((i) => i.id === instrument)?.label ?? "MIDI";
      await onPlace(encodeWav(buffer), `${label} take`, cover);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That take could not be rendered");
    } finally {
      setPlacing(false);
    }
  };
  return { placing, place };
}

export function TakeActions({
  playheadS,
  readOnly = false,
  canCover = false,
  onPlace,
  busy = false,
}: TakeActionsProps) {
  const notes = useMidiStore((s) => s.notes);
  const instrument = useMidiStore((s) => s.instrument);
  const setInstrument = useMidiStore((s) => s.setInstrument);
  const prompt = useMidiStore((s) => s.prompt);
  const setPrompt = useMidiStore((s) => s.setPrompt);
  const strength = useMidiStore((s) => s.strength);
  const setStrength = useMidiStore((s) => s.setStrength);

  const { placing, place } = useTakePlacement(onPlace);
  const duration = notesDuration(notes);
  const disabled = readOnly || busy;

  return (
    <div className="flex flex-col gap-2">
      {/* One press for the whole flow: the dry take is placed, and the cover of
          it is submitted against the next lane. Both clips land — the
          performance and what the model made of it — because the dry one is
          what you compare against, and what you re-cover when a prompt does
          not land. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-[0.7rem]">Instrument</Label>
          <Select value={instrument} onValueChange={setInstrument} disabled={disabled}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INSTRUMENTS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid min-w-48 flex-1 gap-1">
          <Label htmlFor="take-prompt" className="text-muted-foreground text-[0.7rem]">
            Play it as
          </Label>
          <Input
            id="take-prompt"
            value={prompt}
            disabled={disabled || !canCover}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="solo violin, warm vibrato, large concert hall"
            className="h-8"
          />
        </div>

        <div className="grid w-36 gap-1">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="take-strength" className="text-muted-foreground text-[0.7rem]">
              Keep the notes
            </Label>
            <span className="text-muted-foreground font-(family-name:--font-log) text-[0.7rem] tabular-nums">
              {Math.round(strength * 100)}%
            </span>
          </div>
          {/* The dial the whole thing turns on: high and it is your synth with
              a new coat, low and the model starts writing its own notes. */}
          <Slider
            id="take-strength"
            min={0.2}
            max={1}
            step={0.05}
            disabled={disabled || !canCover}
            value={[strength]}
            onValueChange={([v]) => setStrength(v ?? 0.8)}
            className="py-2"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {notes.length
            ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} · ${formatDuration(duration)} → lands at ${formatDuration(playheadS)}`
            : "Nothing to place yet"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !notes.length || placing}
            onClick={() => void place(null)}
          >
            {placing ? "Rendering…" : "Place dry"}
          </Button>
          <Button
            size="sm"
            disabled={disabled || !canCover || !notes.length || placing || !prompt.trim()}
            onClick={() => void place({ prompt: prompt.trim(), strength })}
          >
            <WandSparklesIcon />
            {placing ? "Rendering…" : "Generate instrument"}
          </Button>
        </div>
      </div>

      {!canCover && (
        <p className="text-muted-foreground text-xs">
          No installed model can cover a clip, so the take can only be placed
          dry. ACE-Step is the one that can — install it from Models.
        </p>
      )}
    </div>
  );
}
