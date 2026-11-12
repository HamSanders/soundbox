/**
 * The music request form — model, lyrics/instrumental, styles, track name,
 * advanced settings, quantity and submit.
 *
 * Extracted out of `routes/music-studio.tsx` so a second surface (the Voice
 * Studio's prompt panel for a music/SFX arrangement, see `routes/story.tsx`)
 * can offer the exact same controls — including the prompt assistant
 * (enhance, write lyrics) — instead of a stripped-down copy that drifts from
 * this one. Every field here reads and writes through `useGenerateSession`'s
 * `settings`/`patch`, so both callers stay wired to the same shared session,
 * job stream and store the rest of the app already uses.
 *
 * Purely the form: no takes shelf, no split-pane layout. A caller that wants
 * those (music-studio.tsx) keeps them; a caller that just wants the request
 * side (story.tsx) gets exactly that.
 */

import { useEffect, useState } from "react";
import {
  DicesIcon,
  LoaderCircleIcon,
  XIcon,
  LockIcon,
  LockOpenIcon,
  MicVocalIcon,
  MinusIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  PenLineIcon,
  SquareIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { LicenseChip } from "@/components/license-badge";
import { LoadingVerb } from "@/components/loading-verb";
import { StemChoice } from "@/components/stem-picker";
import { COMMON_STEM_NAMES } from "@/lib/api";
import type { EditKind, Model, Project } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { MAX_EXTEND_TOTAL_S, preferredModel } from "@/lib/session-store";
import type { ComposerSettings } from "@/lib/session-store";

/** What the form calls each edit, in the chip and on the button. */
const EDIT_VERB: Record<EditKind, string> = {
  extend: "Extend",
  cover: "Cover",
  repaint: "Repaint",
};
const EDIT_GERUND: Record<EditKind, string> = {
  extend: "Extending",
  cover: "Covering",
  repaint: "Repainting",
};

const NO_PROJECT = "__none__";

/** The counter under the styles box, and the textarea's own maxLength — a
 *  readability ceiling on one field, not an API limit. */
const PROMPT_MAX = 2000;

/**
 * Style chips — not genres for their own sake, every one names an
 * instrument, a production technique or a decade's timbre, which is what
 * these models actually respond to. Five show at a time and the dice
 * re-deals, because a fixed five would only ever teach the same five words.
 */
const STYLE_POOL = [
  "Brass Section",
  "Atmospheric",
  "80s Pop",
  "R&B",
  "Keys",
  "Analog Synth",
  "Fingerpicked Acoustic",
  "Lo-fi Tape Hiss",
  "Gated Reverb Drums",
  "Upright Bass",
  "String Ensemble",
  "Trap Hi-Hats",
  "Dub Delay",
  "Hammond Organ",
  "Boom Bap Break",
  "Ambient Pads",
  "Muted Funk Guitar",
  "Taiko Drums",
  "Detuned Saw Lead",
  "Bossa Nova Guitar",
  "Choir Swell",
  "Four-on-the-floor",
  "Slide Guitar",
  "Rhodes Piano",
  "Sub Bass",
  "Marimba",
  "Distorted Power Chords",
  "Shuffled Breakbeat",
  "Pizzicato Strings",
  "Vinyl Crackle",
];

function dealStyles(): string[] {
  const pool = [...STYLE_POOL];
  const out: string[] = [];
  for (let i = 0; i < 5 && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/** Common keys, major first then relative minor — the pairing a musician
 *  would actually reach for, not an exhaustive circle of fifths. */
const KEYS = [
  "C major",
  "A minor",
  "G major",
  "E minor",
  "D major",
  "B minor",
  "F major",
  "D minor",
  "Bb major",
  "G minor",
  "Eb major",
  "C minor",
];

export interface MusicRequestFormProps {
  settings: ComposerSettings;
  patch: (patch: Partial<ComposerSettings>) => void;
  model: Model | undefined;
  models: Model[];
  modelsLoading: boolean;
  llmEnabled: boolean;
  enhance: (n?: number) => void;
  enhancing: boolean;
  enhanceError: string | null;
  writeLyrics: () => void;
  writingLyrics: boolean;
  lyricsError: string | null;
  running: boolean;
  canSubmit: boolean;
  submit: () => void;
  cancelCurrent: () => void;
  estimateS: number | null;
  estimateNote: string | null;
  /** Omit to hide the Project field — a caller with its own notion of where
   *  a take belongs (a story's timeline, say) has no use for it. */
  projects?: Project[];
  projectId?: string | null;
  onChangeProject?: (id: string | null) => void;
  /** "Create" on the Music studio, something else wherever this form means
   *  "generate and do something other than just save to the library" with
   *  its result. */
  submitLabel?: string;
  /** Whether a stem-separation model is installed, which is what makes
   *  "split this into tracks" offerable at all. False hides the block rather
   *  than showing a switch that would fail on submit. */
  canSeparate?: boolean;
}

export function MusicRequestForm({
  settings,
  patch,
  model,
  models,
  modelsLoading,
  llmEnabled,
  enhance,
  enhancing,
  enhanceError,
  writeLyrics,
  writingLyrics,
  lyricsError,
  running,
  canSubmit,
  submit,
  cancelCurrent,
  estimateS,
  estimateNote,
  projects,
  projectId,
  onChangeProject,
  submitLabel = "Create",
  canSeparate = false,
}: MusicRequestFormProps) {
  const canSing = Boolean(model?.supports.lyrics);
  // An edit of an existing take. The source rides on the settings so the
  // chip can name it; `editable` is whether *this* model can run it, and
  // `editCapable` the first in the list that can, for the switch offer.
  const edit = settings.edit;
  const source = settings.sourceSound;
  const editable = Boolean(edit && model?.supports[edit]);
  const editCapable = edit
    ? preferredModel(models.filter((m) => m.supports[edit]))
    : undefined;
  const clearEdit = () => patch({ edit: null, sourceSound: null, editOptions: {} });
  // Instrumental is its own state rather than `lyrics === ""`, so clearing
  // the box mid-edit does not silently flip the mode back. A model with no
  // vocal path pins it on: it cannot sing words, so offering the choice
  // would be offering nothing.
  const [instrumental, setInstrumental] = useState(true);
  useEffect(() => {
    if (!canSing) setInstrumental(true);
  }, [canSing]);
  // Starting an edit on a sung take lands with its words in the box, so the
  // box has to be open — otherwise they'd be sung unseen.
  useEffect(() => {
    if (edit && settings.lyrics.trim() && canSing) setInstrumental(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on entering an edit
  }, [edit, source?.id]);
  const vocal = canSing && !instrumental;

  const toggleInstrumental = (on: boolean) => {
    setInstrumental(on);
    // Lyrics left in the box would still be sung — the request sends
    // whatever is there for a lyrics-capable model — so switching to
    // instrumental has to actually empty it.
    if (on) patch({ lyrics: "", trackName: "" });
  };

  const [styles, setStyles] = useState(dealStyles);
  const addStyle = (style: string) => {
    const current = settings.prompt.trim();
    if (current.toLowerCase().includes(style.toLowerCase())) return;
    patch({ prompt: current ? `${current}, ${style}` : style });
  };

  // Quick terms: BPM, a frequency, a key — numbers and units these models'
  // training data is full of, appended into the prompt exactly like a style
  // chip rather than sent as a separate field the backend has nowhere to put.
  const [bpm, setBpm] = useState("");
  const addBpm = () => {
    if (!bpm) return;
    addStyle(`${bpm} BPM`);
    setBpm("");
  };
  const [hz, setHz] = useState("");
  const addHz = () => {
    if (!hz.trim()) return;
    addStyle(hz.trim());
    setHz("");
  };
  const [key, setKey] = useState("");
  const addKey = () => {
    if (!key) return;
    addStyle(key);
    setKey("");
  };

  // An extend may ask for more than the model renders in one pass: the server
  // feeds the clip its own tail and runs several. Clamping the slider to the
  // model's cap would make a clip already at it impossible to extend, which is
  // the case where extending matters most.
  const durationMax =
    edit === "extend" ? MAX_EXTEND_TOTAL_S : (model?.max_duration_s ?? 30);
  // Extending has to add something: the slider's floor is the source's own
  // length (the server refuses anything at or below it).
  const durationMin = edit === "extend" && source ? Math.min(Math.ceil(source.duration_s) + 1, durationMax) : 1;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <Label htmlFor="music-model" className="sr-only">
          Model
        </Label>
        <Select
          // Controlled from the first render, empty string included: handing
          // Radix `undefined` before the catalogue names a default and a
          // string right after is exactly the uncontrolled-to-controlled
          // switch React warns about.
          value={settings.modelId}
          onValueChange={(id) => patch({ modelId: id })}
          disabled={!models.length}
        >
          <SelectTrigger id="music-model" className="w-full">
            <span className="text-muted-foreground mr-1 text-xs">Model</span>
            <SelectValue placeholder={modelsLoading ? "Loading…" : "No model"} />
          </SelectTrigger>
          <SelectContent>
            {models.map((m: Model) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Licence stays on the form rather than a click away: "can I ship
          this?" is the most consequential fact about a music model, and
          different models answer it differently. */}
      {model && <LicenseChip license={model.license} className="self-start" />}

      {/* ------------------------------------------------------------ edit */}
      {edit && source && (
        <div className="border-primary/40 bg-primary/5 rounded-2xl border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="label-caps opacity-70">
                {EDIT_GERUND[edit]}
              </p>
              <p className="truncate text-sm font-medium" title={source.name}>
                {source.name}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatDuration(source.duration_s)}
                {edit === "extend" && ` → ${formatDuration(settings.duration)}`}
                {edit === "cover" && " · same length as the original"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Stop editing this take"
              onClick={clearEdit}
            >
              <XIcon />
            </Button>
          </div>

          {!editable && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-destructive">
                {model ? `${model.name} can't ${edit.toLowerCase()} an existing track.` : "Pick a model first."}
              </span>
              {editCapable && editCapable.id !== model?.id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patch({ modelId: editCapable.id })}
                >
                  Switch to {editCapable.name}
                </Button>
              )}
            </div>
          )}

          {edit === "cover" && editable && (
            <div className="mt-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="cover-strength" className="text-xs">
                  Stay close to the original
                </Label>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {Math.round((settings.editOptions.cover_strength ?? 1) * 100)}%
                </span>
              </div>
              <Slider
                id="cover-strength"
                min={0}
                max={1}
                step={0.05}
                value={[settings.editOptions.cover_strength ?? 1]}
                onValueChange={([v]) =>
                  patch({ editOptions: { ...settings.editOptions, cover_strength: v } })
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- lyrics */}
      <div className="border-border/60 bg-card rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{vocal ? "Lyrics" : "Lyrics disabled"}</span>
          <div className="flex items-center gap-2">
            {canSing ? (
              <Switch id="instrumental" checked={instrumental} onCheckedChange={toggleInstrumental} />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Switch id="instrumental" checked disabled />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {model
                    ? `${model.name} has no vocal path — it cannot sing words.`
                    : "This model cannot sing words."}
                </TooltipContent>
              </Tooltip>
            )}
            <Label htmlFor="instrumental" className="text-muted-foreground text-sm">
              Instrumental
            </Label>
          </div>
        </div>

        {vocal && (
          <div className="mt-3 space-y-2">
            <Textarea
              id="lyrics"
              value={settings.lyrics}
              onChange={(e) => patch({ lyrics: e.target.value })}
              placeholder={"[verse]\nWords to sing, one line at a time"}
              className="min-h-24 resize-y text-sm"
            />
            {llmEnabled && (
              <Button variant="outline" size="sm" onClick={writeLyrics} disabled={writingLyrics}>
                {writingLyrics ? <LoaderCircleIcon className="animate-spin" /> : <MicVocalIcon />}
                {writingLyrics ? <LoadingVerb /> : "Write lyrics"}
              </Button>
            )}
            {lyricsError && <p className="text-destructive text-xs">{lyricsError}</p>}
            <p className="text-muted-foreground text-xs leading-relaxed">
              Sung verbatim. A short render only has room for a few lines — two or four,
              tagged [verse] or [chorus], is what fits.
            </p>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- styles */}
      <div className="border-border/60 bg-card flex min-h-64 flex-1 flex-col rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="prompt" className="text-sm font-medium">
            Styles
          </Label>
          {llmEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Rewrite this into a prompt the model responds to"
                  disabled={enhancing || !settings.prompt.trim()}
                  onClick={() => enhance()}
                >
                  {enhancing ? <LoaderCircleIcon className="animate-spin" /> : <PenLineIcon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {enhancing ? <LoadingVerb /> : "Enhance the prompt"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <Textarea
          id="prompt"
          value={settings.prompt}
          maxLength={PROMPT_MAX}
          onChange={(e) => patch({ prompt: e.target.value })}
          placeholder="Name instruments, tempo and production — 90 BPM boom bap, dusty Rhodes chords, upright bass, vinyl crackle"
          className="mt-2 min-h-40 flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
        />

        {enhanceError && <p className="text-destructive text-xs">{enhanceError}</p>}

        <p className="text-muted-foreground mt-2 text-right text-xs tabular-nums">
          {settings.prompt.length.toLocaleString()} / {PROMPT_MAX.toLocaleString()} characters
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Deal five different styles"
            onClick={() => setStyles(dealStyles())}
          >
            <DicesIcon />
          </Button>
          {styles.map((style) => (
            <Button
              key={style}
              variant="outline"
              size="sm"
              className="px-2.5"
              onClick={() => addStyle(style)}
            >
              <PlusIcon />
              {style}
            </Button>
          ))}
        </div>

        {/* ---------------------------------------------------- quick terms */}
        {/* A number these models respond to more than any adjective — set it
            explicitly and it lands in the prompt as text, the same as a style
            chip, rather than a separate field the backend would have nowhere
            to put. BPM for tempo, Hz for where a low end or a whine actually
            sits (sub-bass, tinnitus whine, a fridge hum), both units a model's
            training data is full of and "fast" or "high-pitched" are not. */}
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="min-w-0">
            <Label htmlFor="quick-bpm" className="text-muted-foreground text-xs">
              Tempo
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <Input
                id="quick-bpm"
                inputMode="numeric"
                value={bpm}
                onChange={(e) => setBpm(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && addBpm()}
                placeholder="120"
                className="h-8 w-16 text-xs"
              />
              <span className="text-muted-foreground text-xs">BPM</span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Add tempo to the styles"
                disabled={!bpm}
                onClick={addBpm}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>
          <div className="min-w-0">
            <Label htmlFor="quick-hz" className="text-muted-foreground text-xs">
              Frequency
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <Input
                id="quick-hz"
                value={hz}
                onChange={(e) => setHz(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addHz()}
                placeholder="80Hz sub-bass"
                className="h-8 w-32 text-xs"
              />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Add frequency to the styles"
                disabled={!hz.trim()}
                onClick={addHz}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>
          <div className="min-w-0">
            <Label htmlFor="quick-key" className="text-muted-foreground text-xs">
              Key
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger id="quick-key" className="h-8 w-28 text-xs" size="sm">
                  <SelectValue placeholder="C minor" />
                </SelectTrigger>
                <SelectContent>
                  {KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Add key to the styles"
                disabled={!key}
                onClick={addKey}
              >
                <PlusIcon />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Song name only where it means something: `track_name` is sent for a
          lyrics-capable model and dropped for any other, so showing the
          field on a model with no vocal path would be showing an input the
          backend discards. */}
      {canSing && (
        <div>
          <Label htmlFor="track-name" className="sr-only">
            Song name
          </Label>
          <Input
            id="track-name"
            value={settings.trackName}
            onChange={(e) => patch({ trackName: e.target.value })}
            placeholder="Song name (optional)"
          />
        </div>
      )}

      {/* --------------------------------------------------------- length */}
      {/* Out here rather than behind "More settings", which is for tuning the
          sampler — steps, CFG, seed. How long the thing is is not a tuning
          knob: it is part of what you are asking for, you decide it before
          you press the button, and on a model that charges by the second it
          is the setting with the most obvious consequence.

          A cover is as long as what it covers — the backend locks it — so
          there the control would be a control over nothing. */}
      {edit !== "cover" && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="duration">{edit === "extend" ? "Extend to" : "Length"}</Label>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {settings.duration.toFixed(1)}s
            </span>
          </div>
          <Slider
            id="duration"
            min={durationMin}
            max={durationMax}
            step={0.5}
            value={[Math.min(Math.max(settings.duration, durationMin), durationMax)]}
            onValueChange={([v]) => patch({ duration: v })}
          />
        </div>
      )}

      {/* ----------------------------------------------------- split into */}
      {/* Not in "More settings": it changes what comes back — stems rather
          than a mix — which is a fact about the result, not a tuning knob.
          An edit is excluded because it already has a source; splitting one
          is the timeline's gesture, on the clip it produced. */}
      {canSeparate && !edit && (
        <div className="border-border/60 bg-card space-y-3 rounded-2xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="split-stems">Split into tracks</Label>
              <p className="text-muted-foreground text-xs">
                Runs the take through the separator before it comes back. You get the
                stems you pick, not the mix — the mix stays in your library behind them.
              </p>
            </div>
            <Switch
              id="split-stems"
              checked={settings.stems !== null}
              onCheckedChange={(on) =>
                patch({ stems: on ? { keep: [...COMMON_STEM_NAMES], rest: "discard" } : null })
              }
            />
          </div>
          {settings.stems && (
            <StemChoice
              picked={
                settings.stems.keep.length ? settings.stems.keep : [...COMMON_STEM_NAMES]
              }
              onPicked={(keep) => patch({ stems: { keep, rest: settings.stems!.rest } })}
              rest={settings.stems.rest}
              onRest={(rest) =>
                patch({ stems: { keep: settings.stems!.keep, rest } })
              }
            />
          )}
        </div>
      )}

      {/* -------------------------------------------------------- advanced */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <SlidersHorizontalIcon />
            {advancedOpen ? "Hide settings" : "More settings"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-border/60 bg-card mt-2 space-y-4 rounded-2xl border p-4">
          {model?.supports.steps && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="steps">Steps</Label>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {settings.steps ?? model.defaults.steps ?? 0}
                </span>
              </div>
              <Slider
                id="steps"
                min={1}
                max={200}
                step={1}
                value={[settings.steps ?? model.defaults.steps ?? 100]}
                onValueChange={([v]) => patch({ steps: v })}
              />
            </div>
          )}

          {model?.supports.cfg && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="cfg">Guidance</Label>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {(settings.cfg ?? model.defaults.cfg ?? 0).toFixed(1)}
                </span>
              </div>
              <Slider
                id="cfg"
                min={1}
                max={model.max_cfg ?? 15}
                step={0.1}
                value={[Math.min(settings.cfg ?? model.defaults.cfg ?? 7, model.max_cfg ?? 15)]}
                onValueChange={([v]) => patch({ cfg: v })}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="seed">Seed</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="seed"
                inputMode="numeric"
                value={settings.seed ?? ""}
                placeholder="Random"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const n = Number(raw);
                  patch({ seed: raw === "" || Number.isNaN(n) ? null : n });
                }}
                className="h-8 w-32 font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={settings.seedLocked}
                aria-label={settings.seedLocked ? "Unlock the seed" : "Lock the seed"}
                onClick={() => patch({ seedLocked: !settings.seedLocked })}
              >
                {settings.seedLocked ? <LockIcon /> : <LockOpenIcon />}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={settings.tags.join(", ")}
              placeholder="Comma separated"
              onChange={(e) =>
                patch({
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              className="h-8 text-xs"
            />
          </div>

          {projects && onChangeProject && (
            <div className="space-y-1.5">
              <Label htmlFor="project">Project</Label>
              <Select
                value={projectId ?? NO_PROJECT}
                onValueChange={(v) => onChangeProject(v === NO_PROJECT ? null : v)}
              >
                <SelectTrigger id="project" className="w-full">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* ---------------------------------------------------------- create */}
      <div className="flex items-center gap-2">
        <div className="border-border/60 flex shrink-0 items-center gap-1 rounded-md border px-2 py-1">
          <span className="text-muted-foreground text-xs">Quantity:</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="One fewer take"
            disabled={settings.variations <= 1}
            onClick={() => patch({ variations: settings.variations - 1 })}
          >
            <MinusIcon />
          </Button>
          <span className="w-4 text-center text-sm tabular-nums">{settings.variations}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="One more take"
            disabled={settings.variations >= 4}
            onClick={() => patch({ variations: settings.variations + 1 })}
          >
            <PlusIcon />
          </Button>
        </div>

        {/* Generate stays live while something is rendering: the server has
            always queued (see `JobManager`), and replacing the button with a
            disabled spinner was the only reason a second take had to wait for
            the first. Stop is its own control beside it rather than a state
            the primary button transposes into — one button that becomes its
            own opposite is how you cancel a render you meant to add to. */}
        <Button className="flex-1" disabled={!canSubmit} onClick={submit}>
          {running ? (
            <>
              <PlusIcon />
              Queue another
            </>
          ) : edit && submitLabel === "Create" ? (
            EDIT_VERB[edit]
          ) : (
            submitLabel
          )}
        </Button>
        {running && (
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label="Cancel this render"
            onClick={cancelCurrent}
          >
            <SquareIcon />
          </Button>
        )}
      </div>

      {estimateS != null && !running && (
        <p className="text-muted-foreground text-center text-xs" title={estimateNote ?? undefined}>
          About {Math.round(estimateS)}s on this machine
        </p>
      )}
    </div>
  );
}
