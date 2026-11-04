/**
 * Paste a script or a passage and get lines.
 *
 * Auto-cast reads screenplay cues ("MARA:", a name alone in capitals) and
 * "said X" attributions and gives each character a voice: a voice with the
 * same name if there is one, otherwise the next unused voice. Split cuts
 * prose into lines by sentence, paragraph or chapter with nobody cast, for a
 * narration. Both show what they would add before anything is added, and
 * nothing already in the script is touched.
 */

import { useMemo, useState } from "react";
import { ClipboardPasteIcon, ListPlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SegmentCreate, Voice } from "@/lib/api";
import {
  autoCast,
  castVoices,
  DEFAULT_MAX_CHARS,
  splitIntoLines,
  type SplitMode,
} from "@/lib/script-parse";

type Mode = "cast" | SplitMode;

const MODE_LABEL: Record<Mode, string> = {
  cast: "Auto-cast speakers",
  sentence: "Split by sentence",
  paragraph: "Split by paragraph",
  chapter: "Split by chapter",
};

export function ScriptImportPanel({
  voices,
  onAdd,
  onClose,
  initialText = "",
}: {
  voices: Voice[];
  /** Appends these to the script, in order. */
  onAdd: (lines: SegmentCreate[]) => void;
  onClose: () => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<Mode>("cast");
  const [maxChars, setMaxChars] = useState(String(DEFAULT_MAX_CHARS));
  const limit = Math.max(40, Number(maxChars) || DEFAULT_MAX_CHARS);

  const plan = useMemo(() => {
    if (mode === "cast") {
      const { lines, characters } = autoCast(text, limit);
      const cast = castVoices(characters, voices);
      return {
        lines: lines.map<SegmentCreate>((l) => ({
          text: l.text,
          speaker: l.speaker,
          voice_id: l.speaker ? (cast.get(l.speaker) ?? null) : null,
        })),
        characters,
        cast,
      };
    }
    return {
      lines: splitIntoLines(text, mode, limit).map<SegmentCreate>((t) => ({ text: t })),
      characters: [] as string[],
      cast: new Map<string, string | null>(),
    };
  }, [text, mode, limit, voices]);

  const n = plan.lines.length;
  const voiceName = (id: string | null) => voices.find((v) => v.id === id)?.name ?? "story default";

  return (
    <div className="bg-muted/30 ring-border/60 mb-2 space-y-2.5 rounded-lg p-3 ring-1 ring-inset">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ClipboardPasteIcon className="size-4" aria-hidden="true" />
          Paste a script
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} className="size-6">
          <XIcon />
        </Button>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
        placeholder={"MARA: You said the door would be open.\nTHEO: I said it might be.\n\nOr a passage of prose: it is split into lines, and quoted dialogue with “said Mara” is cast to Mara."}
        className="text-sm"
        aria-label="Script or passage to turn into lines"
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Into</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="script-max-chars" className="text-xs">
            Longest line
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="script-max-chars"
              inputMode="numeric"
              value={maxChars}
              onChange={(e) => setMaxChars(e.target.value.replace(/\D/g, ""))}
              className="h-8 w-20 font-mono text-xs"
            />
            <span className="text-muted-foreground text-xs">characters</span>
          </div>
        </div>
      </div>

      {text.trim() && (
        <div className="text-muted-foreground text-xs leading-relaxed">
          {n === 0 ? (
            "Nothing to add yet."
          ) : (
            <>
              <span className="text-foreground">
                {n} line{n === 1 ? "" : "s"}
              </span>
              {mode === "cast" && plan.characters.length > 0 && (
                <>
                  {" · "}
                  {plan.characters.map((c, i) => (
                    <span key={c}>
                      {i > 0 && ", "}
                      <span className="text-foreground">{c}</span>
                      {" → "}
                      {voiceName(plan.cast.get(c) ?? null)}
                    </span>
                  ))}
                  {plan.lines.some((l) => !l.speaker) && (
                    <>
                      {", "}narration → story default
                    </>
                  )}
                </>
              )}
              {mode === "cast" && plan.characters.length === 0 && (
                <> · no speakers found, so every line reads in the story's default voice</>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Lines already in the script stay as they are.
        </p>
        <Button
          size="sm"
          disabled={n === 0}
          onClick={() => {
            onAdd(plan.lines);
            onClose();
          }}
        >
          <ListPlusIcon className="size-3.5" aria-hidden="true" />
          Add {n > 0 ? `${n} line${n === 1 ? "" : "s"}` : "lines"}
        </Button>
      </div>
    </div>
  );
}
