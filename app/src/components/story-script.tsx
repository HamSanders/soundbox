/**
 * The script, as a script — not a stack of forms.
 *
 * The first version of this was one card per line, each with its own speaker
 * field, voice dropdown, textarea and button row. That is a fine shape for a
 * settings screen and a terrible one for writing: the chrome outweighed the
 * words, and reading your own scene meant reading past four controls per line.
 *
 * So the controls went inline and became commands. A line is a line of text
 * with a voice on it; you set the voice by typing `/` where you are already
 * typing, and you write a beat of silence by typing `#`, the same way you
 * would mark one in a stage direction. Nothing is hidden — the voice shows as
 * a chip and the pause shows as a rule — but nothing is *presented* either
 * until you ask for it.
 *
 * The trade this makes is discoverability, which is why the hint line sits
 * above the script and the chips stay clickable: someone who never types a
 * slash can still do everything with the mouse.
 *
 * The third thing a line carries is a delivery: the handful of knobs the
 * chosen model family actually listens to (`DeliveryControls`, read from
 * audio.cpp's own parameter table). Those live in the same two places
 * everything else here does — one default for the story, sitting with the hint
 * line, and an override on the line that needs to be angrier, reached from the
 * row it belongs to. A model that lists no knobs says so in a sentence instead
 * of showing a panel of controls that do nothing.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ClipboardPasteIcon,
  MicIcon,
  SlidersHorizontalIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeliveryControls } from "@/components/delivery-controls";
import { EmptyState } from "@/components/empty-state";
import { ScriptImportPanel } from "@/components/script-import-panel";
import { autoCast, castVoices, SAMPLE_SCRIPT } from "@/lib/script-parse";
import { PeakScrubber } from "@/components/peak-scrubber";
import { VoiceAvatar } from "@/components/voice-avatar";
import { cn } from "@/lib/utils";
import type {
  Model,
  ModelParam,
  SegmentCreate,
  SegmentPatch,
  StorySegment,
  Voice,
} from "@/lib/api";

/** What `#` inserts, and the lengths the pause chip cycles through. */
const PAUSE_STEPS = [0.25, 0.5, 1, 2, 3];
const DEFAULT_PAUSE = 0.5;

export interface StoryScriptProps {
  segments: StorySegment[];
  voices: Voice[];
  model: Model | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: SegmentPatch) => void;
  onCreate: (values: SegmentCreate) => void;
  /** Append several lines at once, in order — a pasted script. Falls back to
   *  one `onCreate` per line when the studio does not provide it. */
  onCreateMany?: (values: SegmentCreate[]) => void;
  onDelete: (id: string) => void;
  onGenerate: (id: string) => void;
  /** The story's default delivery, and the setter for it. Every line without
   *  its own override is read with this. */
  storyOptions?: Record<string, string>;
  onStoryOptions?: (next: Record<string, string>) => void;
  /** True while an agent holds this story — the script stays readable, it
   *  just stops accepting edits that would race the agent. */
  readOnly?: boolean;
  /** Ids with a read currently in flight, so their rows can say so. */
  generating: Set<string>;
  /** The line being auditioned from its own row, if any. */
  auditionId?: string | null;
  /** Playhead within the auditioned line, in seconds. */
  auditionTime?: number;
  /** Seek the auditioned line. */
  onAuditionSeek?: (seconds: number) => void;
  onAudition: (id: string) => void;
  /**
   * The line the timeline's playhead is currently inside, highlighted so the
   * script reads along with playback — and with a scrub, since the timeline
   * reports the same id either way.
   *
   * Separate from `selectedId` on purpose: selection is where you are working,
   * this is where the audio is. They are frequently not the same line, and
   * collapsing them would mean playback stole your edit cursor.
   */
  activeId?: string | null;
}

export function StoryScript({
  segments,
  voices,
  model,
  selectedId,
  onSelect,
  onPatch,
  onCreate,
  onCreateMany,
  onDelete,
  onGenerate,
  generating,
  storyOptions = {},
  onStoryOptions,
  readOnly = false,
  activeId = null,
  auditionId = null,
  auditionTime = 0,
  onAuditionSeek,
  onAudition,
}: StoryScriptProps) {
  /** Which row a command menu is open on, and what triggered it. */
  const [menu, setMenu] = useState<{ id: string; kind: "voice" } | null>(null);
  /** Set when a row should take focus after the list re-renders — creating a
   *  line and then having to click it would defeat the point. */
  const focusRef = useRef<string | null>(null);

  // No filtering by a single model any more: a line's voice is what names the
  // model that reads it, so every voice the page hands down is castable here.
  // `model` is only the delivery knobs' vocabulary — see the studio.

  const params = model?.params ?? [];

  /** The paste panel, above the lines. */
  const [importOpen, setImportOpen] = useState(false);

  const addMany = (values: SegmentCreate[]): void => {
    if (values.length === 0) return;
    if (onCreateMany) onCreateMany(values);
    else for (const v of values) onCreate(v);
  };

  /** The sample scene: cast through the same parser a paste goes through, so
   *  "Load sample" is a demonstration of Auto-cast and not a special case. */
  const loadSample = (): void => {
    const { lines, characters } = autoCast(SAMPLE_SCRIPT);
    const cast = castVoices(characters, voices);
    addMany(
      lines.map((l) => ({
        text: l.text,
        speaker: l.speaker,
        voice_id: l.speaker ? (cast.get(l.speaker) ?? null) : null,
      })),
    );
  };

  if (segments.length === 0 && !importOpen) {
    return (
      <EmptyState
        icon={ClipboardPasteIcon}
        title="No lines yet"
        size="sm"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" disabled={readOnly} onClick={() => onCreate({})}>
              Add first line
            </Button>
            <Button size="sm" variant="outline" disabled={readOnly} onClick={() => setImportOpen(true)}>
              Paste a script
            </Button>
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={loadSample}>
              Load sample
            </Button>
          </div>
        }
      >
        Write a line, paste a scene and let Auto-cast hand out the voices, or load a short
        sample to hear how it works.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-1">
      {importOpen && (
        <ScriptImportPanel
          voices={voices}
          onAdd={addMany}
          onClose={() => setImportOpen(false)}
        />
      )}
      <div className="flex items-start justify-between gap-2 px-1 pb-1">
        <p className="text-muted-foreground text-xs">
          Type <Key>/</Key> to set a voice, <Key>#</Key> for a pause, <Key>Enter</Key> for a
          new line.
        </p>
        {!importOpen && (
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            onClick={() => setImportOpen(true)}
            className="text-muted-foreground hover:text-foreground h-6 shrink-0 gap-1 px-1.5 text-xs"
          >
            <ClipboardPasteIcon className="size-3.5" aria-hidden="true" />
            Paste a script
          </Button>
        )}
        {onStoryOptions && (
          <DeliveryButton
            label="Delivery"
            title={`How ${model?.name ?? "this model"} reads every line`}
            description="Applies to every line that has no setting of its own."
            params={params}
            value={storyOptions}
            onChange={onStoryOptions}
            inheritedLabel="the model's defaults"
            disabled={readOnly}
          />
        )}
      </div>

      {segments.map((segment, i) =>
        segment.kind === "pause" ? (
          <PauseRow
            key={segment.id}
            segment={segment}
            selected={segment.id === selectedId}
            active={segment.id === activeId}
            onSelect={() => onSelect(segment.id)}
            onCycle={() => {
              const at = PAUSE_STEPS.indexOf(segment.duration_s ?? DEFAULT_PAUSE);
              onPatch(segment.id, {
                duration_s: PAUSE_STEPS[(at + 1) % PAUSE_STEPS.length],
              });
            }}
            onDelete={() => onDelete(segment.id)}
          />
        ) : (
          <LineRow
            key={segment.id}
            segment={segment}
            voices={voices}
            allowModelDefault={!model?.requires_voice_reference}
            selected={segment.id === selectedId}
            active={segment.id === activeId}
            menuOpen={menu?.id === segment.id}
            busy={generating.has(segment.id)}
            readOnly={readOnly}
            autoFocus={focusRef.current === segment.id}
            onFocused={() => {
              if (focusRef.current === segment.id) focusRef.current = null;
            }}
            onSelect={() => onSelect(segment.id)}
            onText={(text) => onPatch(segment.id, { text })}
            onSpeaker={(speaker) => onPatch(segment.id, { speaker })}
            onVoice={(voiceId) => {
              onPatch(segment.id, { voice_id: voiceId });
              setMenu(null);
            }}
            onOpenMenu={() => setMenu({ id: segment.id, kind: "voice" })}
            onCloseMenu={() => setMenu(null)}
            onGenerate={() => onGenerate(segment.id)}
            onDelete={() => onDelete(segment.id)}
            onEnter={() =>
              // A new line inherits the voice of the one it came from: a
              // speaker usually says more than one sentence, and re-picking
              // per line is exactly the friction this rewrite is removing.
              onCreate({
                position: segment.position + 1,
                voice_id: segment.voice_id,
                speaker: segment.speaker,
              })
            }
            onPause={() =>
              onCreate({
                position: segment.position + 1,
                kind: "pause",
                duration_s: DEFAULT_PAUSE,
              })
            }
            index={i}
            auditioning={auditionId === segment.id}
            auditionTime={auditionTime}
            onAuditionSeek={onAuditionSeek}
            onAudition={() => onAudition(segment.id)}
            params={params}
            modelName={model?.name}
            storyOptions={storyOptions}
            onOptions={(request_options) => onPatch(segment.id, { request_options })}
          />
        ),
      )}

      <button
        type="button"
        disabled={readOnly}
        onClick={() => onCreate({})}
        className="text-muted-foreground hover:bg-accent/50 hover:text-foreground w-full rounded-md px-2 py-2 text-left text-sm transition-colors"
      >
        Write another line…
      </button>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

/* ---------------------------------------------------------------- one line */

function LineRow({
  segment,
  voices,
  allowModelDefault,
  selected,
  active,
  menuOpen,
  busy,
  readOnly,
  autoFocus,
  onFocused,
  onSelect,
  onText,
  onSpeaker,
  onVoice,
  onOpenMenu,
  onCloseMenu,
  onGenerate,
  onDelete,
  onEnter,
  onPause,
  index,
  auditioning,
  auditionTime,
  onAuditionSeek,
  onAudition,
  params,
  modelName,
  storyOptions,
  onOptions,
}: {
  segment: StorySegment;
  voices: Voice[];
  allowModelDefault: boolean;
  selected: boolean;
  active: boolean;
  menuOpen: boolean;
  busy: boolean;
  readOnly: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onSelect: () => void;
  onText: (text: string) => void;
  onSpeaker: (speaker: string | null) => void;
  onVoice: (voiceId: string | null) => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onGenerate: () => void;
  onDelete: () => void;
  onEnter: () => void;
  onPause: () => void;
  index: number;
  auditioning: boolean;
  auditionTime: number;
  onAuditionSeek?: (seconds: number) => void;
  onAudition: () => void;
  /** The knobs the chosen model family accepts. Empty for a family that takes
   *  none, which the panel says in words rather than showing nothing. */
  params: ModelParam[];
  modelName?: string;
  /** The story's default, shown behind any value this line has not set. */
  storyOptions: Record<string, string>;
  onOptions: (next: Record<string, string>) => void;
}) {
  const [text, setText] = useState(segment.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);
  /** What has been typed since `/` opened the menu, used to filter it. */
  const [filter, setFilter] = useState("");

  useEffect(() => setText(segment.text), [segment.text]);

  // Typing is saved a beat after it stops. Whatever is still waiting when the
  // row loses focus or goes away is saved then — dropping it lost the last
  // words of a line to any click elsewhere inside 400ms.
  const pending = useRef<string | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const flush = useCallback((): void => {
    window.clearTimeout(timer.current ?? undefined);
    timer.current = null;
    if (pending.current === null) return;
    const value = pending.current;
    pending.current = null;
    onTextRef.current(value);
  }, []);
  useEffect(() => flush, [flush]);

  // Grow to fit rather than scroll: a script is read as a whole, and a line
  // that hides its own second half is not a script.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (area === null) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) {
      areaRef.current?.focus();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const commit = (value: string): void => {
    window.clearTimeout(timer.current ?? undefined);
    pending.current = value;
    timer.current = window.setTimeout(flush, 400);
  };

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const voice = voices.find((v) => v.id === segment.voice_id) ?? null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menuOpen) {
      // While the menu is up it owns Escape and Enter; everything else keeps
      // typing, which is what filters it.
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseMenu();
        setFilter("");
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      window.clearTimeout(timer.current ?? undefined);
      onText(text);
      onEnter();
      return;
    }
    // Backspace on an empty line removes it, the way it would in any editor.
    if (e.key === "Backspace" && text === "" && index > 0) {
      e.preventDefault();
      onDelete();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value;
    const caret = e.target.selectionStart;
    const justTyped = value[caret - 1];

    // `#` is a command, not a character: it never lands in the text.
    if (justTyped === "#") {
      const stripped = value.slice(0, caret - 1) + value.slice(caret);
      setText(stripped);
      commit(stripped);
      onPause();
      return;
    }
    // `/` opens the voice menu and likewise does not survive as text.
    if (justTyped === "/") {
      const stripped = value.slice(0, caret - 1) + value.slice(caret);
      setText(stripped);
      commit(stripped);
      setFilter("");
      onOpenMenu();
      return;
    }
    setText(value);
    commit(value);
    if (menuOpen) setFilter(value.slice(0, caret));
  };

  return (
    <div
      ref={rowRef}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative rounded-md px-2 py-1.5 transition-colors",
        selected ? "bg-accent/60" : "hover:bg-accent/30",
        active && "bg-primary/10 ring-primary/40 ring-1",
      )}
      onClick={onSelect}
    >
      {/* Same crawling outline the clip on the timeline gets, so "this one is
          being read" looks the same wherever you are looking. */}
      {busy && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <rect
            x="1"
            y="1"
            width="calc(100% - 2px)"
            height="calc(100% - 2px)"
            rx="5"
            fill="none"
            className="stroke-primary/60 soundbox-crawl"
            strokeWidth="1.5"
            strokeDasharray="8 4"
          />
        </svg>
      )}

      <div className="flex items-start gap-2">
        {/* The voice chip is the line's identity and its control at once —
            clicking it is the mouse equivalent of typing a slash. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
          className={cn(
            "mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
            voice
              ? "bg-primary/15 text-primary hover:bg-primary/25"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {/* The picture, when there is a saved voice behind the line: at this
              size it is the fastest way to see a script has switched speaker,
              and it is the same tile the Lab and the composer show. A line
              with only a typed speaker name has no voice to draw. */}
          {voice && <VoiceAvatar voice={voice} className="-ml-0.5 size-4 rounded-full" />}
          {segment.speaker || voice?.name || "voice"}
          <ChevronDownIcon className="size-3" />
        </button>

        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          readOnly={readOnly}
          placeholder="Write the line…"
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onSelect}
          onBlur={flush}
          className="placeholder:text-muted-foreground/60 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-6 outline-none"
        />

        <div className="mt-0.5 flex shrink-0 items-center gap-1">
          {auditioning && segment.sound && onAuditionSeek && (
            <PeakScrubber
              peaks={segment.sound.peaks}
              durationS={segment.sound.duration_s}
              currentTime={auditionTime}
              onSeek={onAuditionSeek}
              label="Seek this line"
              className="h-5 w-20 shrink-0"
            />
          )}
          {segment.duration_s ? (
            <span className="text-muted-foreground font-(family-name:--font-log) text-[10px] tabular-nums">
              {segment.duration_s.toFixed(1)}s
            </span>
          ) : null}
          {segment.sound && (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                auditioning && "opacity-100",
              )}
              aria-label={auditioning ? "Stop" : "Play this line"}
              onClick={(e) => {
                e.stopPropagation();
                onAudition();
              }}
            >
              {auditioning ? <SquareIcon /> : <PlayIcon />}
            </Button>
          )}
          {/* Only for a line that departs from the story's delivery, or a
              hover — a settings icon on every row all the time is the chrome
              this editor exists to keep out of the way. */}
          <DeliveryButton
            icon
            label="Delivery"
            title={`How ${modelName ?? "this model"} reads this line`}
            description="Overrides the story's delivery for this line only."
            params={params}
            value={segment.request_options}
            onChange={onOptions}
            inherited={storyOptions}
            inheritedLabel={
              Object.keys(storyOptions).length > 0 ? "the story's delivery" : "the model's defaults"
            }
            disabled={readOnly}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              busy && "opacity-100",
            )}
            aria-label={segment.sound_id ? "Read this line again" : "Read this line"}
            disabled={readOnly || busy || !text.trim()}
            onClick={(e) => {
              e.stopPropagation();
              onGenerate();
            }}
          >
            <MicIcon className={cn(busy && "animate-pulse")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Delete this line"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {menuOpen && (
        <VoiceMenu
          voices={voices}
          filter={filter}
          allowModelDefault={allowModelDefault}
          currentId={segment.voice_id ?? null}
          onPick={(id) => {
            onVoice(id);
            setFilter("");
            areaRef.current?.focus();
          }}
          onName={(name) => {
            onSpeaker(name);
            setFilter("");
          }}
          onClose={() => {
            onCloseMenu();
            setFilter("");
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- voice menu */

function VoiceMenu({
  voices,
  filter,
  allowModelDefault,
  currentId,
  onPick,
  onName,
  onClose,
}: {
  voices: Voice[];
  filter: string;
  allowModelDefault: boolean;
  currentId: string | null;
  onPick: (id: string | null) => void;
  onName: (name: string) => void;
  onClose: () => void;
}) {
  // Filter on whatever was typed after the slash, matching how every other
  // slash menu behaves.
  const q = filter.trim().toLowerCase();
  const matches = voices.filter((v) => !q || v.name.toLowerCase().includes(q));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="bg-popover border-border absolute top-full left-8 z-50 mt-1 w-60 rounded-lg border p-1 shadow-lg">
        {allowModelDefault && (
          <MenuItem active={currentId === null} onClick={() => onPick(null)}>
            Model default
          </MenuItem>
        )}
        {matches.map((v) => (
          <MenuItem key={v.id} active={currentId === v.id} onClick={() => onPick(v.id)}>
            <VoiceAvatar voice={v} className="size-5 rounded-full" />
            <span className="truncate">{v.name}</span>
            {v.kind === "builtin" && (
              <span className="text-muted-foreground ml-auto text-[10px]">built-in</span>
            )}
          </MenuItem>
        ))}
        {matches.length === 0 && (
          <p className="text-muted-foreground px-2 py-2 text-xs">
            {q ? (
              <>
                No voice matches “{q}”.{" "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-2"
                  onClick={() => onName(filter.trim())}
                >
                  Use it as a speaker name
                </button>
              </>
            ) : (
              "No voices yet — make one in the Voice Lab."
            )}
          </p>
        )}
      </div>
    </>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
        active && "text-primary",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- pause */

/** A pause reads as a break in the script rather than a row of it — a rule
 *  with its length on it, the way a beat is marked in a stage direction. */
function PauseRow({
  segment,
  selected,
  active,
  onSelect,
  onCycle,
  onDelete,
}: {
  segment: StorySegment;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
  onCycle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      aria-current={active ? "true" : undefined}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
        selected ? "bg-accent/60" : "hover:bg-accent/30",
        active && "bg-primary/10 ring-primary/40 ring-1",
      )}
      onClick={onSelect}
    >
      <div className="border-border flex-1 border-t border-dashed" />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCycle();
        }}
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1 rounded px-1.5 py-0.5 font-(family-name:--font-log) text-[10px] tabular-nums transition-colors"
        title="Click to change the length"
      >
        <PauseIcon className="size-2.5" />
        {(segment.duration_s ?? DEFAULT_PAUSE).toFixed(2).replace(/0$/, "")}s
      </button>
      <div className="border-border flex-1 border-t border-dashed" />
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 opacity-0 group-hover:opacity-100"
        aria-label="Delete this pause"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- delivery */

/**
 * The delivery panel, behind one button.
 *
 * Two mounts, one component: the story's default sits with the hint line, a
 * line's override sits in its own row. Both edit the same shape, and the only
 * difference is what an unset knob falls back to — which is why `inherited`
 * exists rather than the caller pre-merging the two. Merging would make a
 * value the story set look like a value this line chose, and the whole point
 * of the override is being able to see which is which.
 *
 * The count on the trigger is the affordance: a line reading differently from
 * the rest of the script says so without being opened.
 */
function DeliveryButton({
  label,
  title,
  description,
  params,
  value,
  onChange,
  inherited,
  inheritedLabel,
  disabled = false,
  icon = false,
}: {
  label: string;
  title: string;
  description: string;
  params: ModelParam[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  inherited?: Record<string, string>;
  inheritedLabel: string;
  disabled?: boolean;
  icon?: boolean;
}) {
  const count = Object.keys(value).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {icon ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={title}
            className={cn(
              "size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              count > 0 && "text-primary opacity-100",
            )}
          >
            <SlidersHorizontalIcon />
          </Button>
        ) : (
          <button
            type="button"
            className={cn(
              "hover:bg-accent flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
              count > 0 ? "bg-primary/15 text-primary" : "text-muted-foreground",
            )}
          >
            <SlidersHorizontalIcon className="size-3" />
            {label}
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-3">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <DeliveryControls
          params={params}
          value={value}
          onChange={onChange}
          inherited={inherited}
          inheritedLabel={inheritedLabel}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
