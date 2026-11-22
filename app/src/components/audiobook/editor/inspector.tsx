/**
 * The editor's right column. With a paragraph selected: who reads it, its
 * model override, lock and heading, and its delivery. With nothing
 * selected: the chapter, its stats, and the soundscape slot. The cast and
 * pronunciation panels from the voice area sit in their own tabs.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, LockIcon, UnlockIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { BedsPanel } from "@/components/audiobook/beds";
import { CastPanel } from "@/components/audiobook/cast";
import { PronunciationPanel } from "@/components/audiobook/pronounce";
import { DeliveryControls } from "@/components/delivery-controls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import {
  CHAPTER_KIND_LABELS,
  type BookDetail,
  type ChapterWithStats,
  type Paragraph,
} from "@/lib/audiobook-api";
import { abk, useUpdateChapter, useUpdateParagraph } from "@/lib/audiobook-queries";
import type { ChapterKind } from "@/lib/audiobook-types";
import { formatDuration } from "@/lib/format";
import { useStory } from "@/lib/queries";
import { toast } from "sonner";

import { characterById } from "./cast-colors";
import { CastDot } from "./character-chip";
import { StatusBadge } from "./paragraph-row";
import type { BookOps } from "./use-book-ops";
import { resolveModel, useTts } from "./use-tts";

const VOICE_MODEL = "__voice__";
const NARRATOR = "__narrator__";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ParagraphInspector({
  book,
  chapter,
  paragraph,
  number,
  ops,
}: {
  book: BookDetail;
  chapter: ChapterWithStats;
  paragraph: Paragraph;
  /** 1-based, among the chapter's paragraphs (beds on other tracks aren't counted). */
  number: number;
  ops: BookOps;
}) {
  const qc = useQueryClient();
  const tts = useTts();
  const story = useStory(chapter.story_id);
  const update = useUpdateParagraph(book.id, chapter.id);
  const character = characterById(book.characters, paragraph.character_id);
  const modelId = resolveModel({
    paragraphModel: paragraph.model_id,
    characterModel: character?.model_id ?? null,
    multiCast: book.settings.cast_mode === "multi",
    bookModel: book.settings.model_id,
    voiceId: paragraph.voice_id,
    voices: tts.allVoices,
    models: tts.models,
  });
  const model = tts.models.find((m) => m.id === modelId);
  const voice = tts.allVoices.find((v) => v.id === paragraph.voice_id);

  const delivery = useMutation({
    mutationFn: (options: Record<string, string>) =>
      api.updateSegment(chapter.story_id, paragraph.id, { request_options: options }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: abk.paragraphs(book.id, chapter.id) }),
    onError: (err) => toast.error("Could not save the delivery", { description: errorMessage(err) }),
  });

  return (
    <div className="space-y-5 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Paragraph {number}</h3>
        <StatusBadge status={paragraph.status} />
      </div>

      <Field label="Read by">
        <Select
          value={paragraph.character_id ?? NARRATOR}
          onValueChange={(v) =>
            void ops.cast([paragraph], v === NARRATOR ? null : v)
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NARRATOR}>
              <CastDot color={0} /> Narrator
            </SelectItem>
            {book.characters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <CastDot color={c.color} /> {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Voice: {voice?.name ?? "none set"}
          {modelId ? ` · reads on ${model?.name ?? `${modelId}, which is not installed`}` : " · no text-to-speech model is installed"}
          {book.settings.cast_mode === "single" && character ? " (single cast: narrator's voice)" : ""}
        </p>
      </Field>

      {/* A voice reads on the model it was made on; overriding that is rare,
          so it sits under Advanced. */}
      <details className="group" open={paragraph.model_id ? true : undefined}>
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs select-none">
          Advanced{paragraph.model_id ? " · model overridden" : ""}
        </summary>
        <div className="mt-2">
          <Field label="Model for this paragraph">
            <Select
              value={paragraph.model_id ?? VOICE_MODEL}
              onValueChange={(v) =>
                update.mutate({ id: paragraph.id, patch: { model_id: v === VOICE_MODEL ? null : v } })
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={VOICE_MODEL}>The voice's own model</SelectItem>
                {tts.models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {paragraph.model_id
                ? "A cloned voice may not sound like itself on another model."
                : "Change this only for a line the voice's model gets wrong."}
            </p>
          </Field>
        </div>
      </details>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          Locked
          <Switch
            checked={paragraph.locked}
            onCheckedChange={(locked) => void ops.setLocked([paragraph], locked)}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Chapter heading
          <Switch
            checked={paragraph.is_heading}
            onCheckedChange={(is_heading) => update.mutate({ id: paragraph.id, patch: { is_heading } })}
          />
        </label>
      </div>

      <div className="space-y-2">
        <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Delivery
        </h4>
        {model ? (
          <DeliveryControls
            params={model.params}
            value={paragraph.request_options}
            inherited={story.data?.request_options ?? {}}
            inheritedLabel="the book"
            disabled={paragraph.locked || delivery.isPending}
            onChange={(next) => delivery.mutate(next)}
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            Install a text-to-speech model to set how this paragraph is read.
          </p>
        )}
      </div>
    </div>
  );
}

function ChapterInspector({ book, chapter }: { book: BookDetail; chapter: ChapterWithStats }) {
  const update = useUpdateChapter(book.id);
  const s = chapter.stats;
  return (
    <div className="space-y-5 p-3">
      <div>
        <h3 className="truncate text-sm font-medium">{chapter.title}</h3>
        <p className="text-muted-foreground text-xs">{CHAPTER_KIND_LABELS[chapter.kind]}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Paragraphs", s.paragraphs],
          ["Voiced", `${s.voiced}/${s.paragraphs}`],
          ["Locked", s.locked],
          ["Length", s.duration_s > 0 ? formatDuration(s.duration_s) : "—"],
          ["Characters", s.characters.toLocaleString()],
        ].map(([k, v]) => (
          <div key={k} className="bg-muted/40 rounded-md px-2 py-1.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <Field label="Kind">
        <Select
          value={chapter.kind}
          onValueChange={(kind) => update.mutate({ id: chapter.id, patch: { kind: kind as ChapterKind } })}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHAPTER_KIND_LABELS) as ChapterKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {CHAPTER_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-2 text-sm">
        Include in render and export
        <Switch
          checked={chapter.included}
          onCheckedChange={(included) => update.mutate({ id: chapter.id, patch: { included } })}
        />
      </label>
      <Button variant="outline" size="sm" className="w-full" asChild>
        <Link to={`/studio/script/${chapter.story_id}`}>
          <ExternalLinkIcon />
          Open in timeline
        </Link>
      </Button>
      <BedsPanel bookId={book.id} chapterId={chapter.id} />
    </div>
  );
}

export function Inspector({
  book,
  chapter,
  paragraph,
  paragraphNumber,
  selectedCount,
  onLockSelection,
  ops,
}: {
  book: BookDetail;
  chapter: ChapterWithStats | null;
  paragraph: Paragraph | null;
  selectedCount: number;
  onLockSelection: (locked: boolean) => void;
  ops: BookOps;
  paragraphNumber: number;
}) {
  return (
    <Tabs defaultValue="inspect" className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList className="mx-3 mt-3 w-auto">
        <TabsTrigger value="inspect">Inspect</TabsTrigger>
        <TabsTrigger value="cast">Cast</TabsTrigger>
        <TabsTrigger value="pronounce">Pronounce</TabsTrigger>
      </TabsList>
      <TabsContent value="inspect" className="min-h-0 flex-1 overflow-y-auto">
        {selectedCount > 1 ? (
          <div className="space-y-3 p-3">
            <h3 className="text-sm font-medium">{selectedCount} paragraphs selected</h3>
            <p className="text-muted-foreground text-xs">
              Use the bar above the paragraphs to assign a character, or lock them all.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onLockSelection(true)}>
                <LockIcon />
                Lock
              </Button>
              <Button size="sm" variant="outline" onClick={() => onLockSelection(false)}>
                <UnlockIcon />
                Unlock
              </Button>
            </div>
          </div>
        ) : paragraph && chapter ? (
          <ParagraphInspector
            book={book}
            chapter={chapter}
            paragraph={paragraph}
            number={paragraphNumber}
            ops={ops}
          />
        ) : chapter ? (
          <ChapterInspector book={book} chapter={chapter} />
        ) : null}
      </TabsContent>
      <TabsContent value="cast" className="min-h-0 flex-1 overflow-y-auto">
        <CastPanel bookId={book.id} />
        <SlotPlaceholder>Characters and their voices appear here.</SlotPlaceholder>
      </TabsContent>
      <TabsContent value="pronounce" className="min-h-0 flex-1 overflow-y-auto">
        <PronunciationPanel bookId={book.id} />
        <SlotPlaceholder>The pronunciation dictionary appears here.</SlotPlaceholder>
      </TabsContent>
    </Tabs>
  );
}

/** Shown under a slot, and hidden by CSS once the slot renders anything. */
function SlotPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground p-3 text-xs [&:not(:only-child)]:hidden">
      {children}
    </p>
  );
}
