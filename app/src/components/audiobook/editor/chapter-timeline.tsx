/**
 * The chapter's timeline, docked under the paragraphs: the studio's
 * `StoryTimeline` on the chapter's own story, so the text and the arrangement
 * are one thing seen two ways (a chapter *is* a story, and each paragraph is
 * one of its clips).
 *
 * The narration ripples. Its clips sit end to end with the book's pacing, the
 * way the render lays them out, so dragging a paragraph's clip reorders the
 * paragraphs and the chapter re-packs, and voicing one to a new length pushes
 * the rest along. Whatever leaves the narration unpacked (a voice landing, an
 * undo, a reorder in the text) is re-laid here once. Narration isn't split,
 * duplicated or moved to another lane from the timeline: those are edits to
 * the text. Beds, recordings and imported sounds on the other lanes behave as
 * they do in the studio.
 *
 * Edits share the editor's undo history, so Ctrl+Z walks back both.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { voiceApi } from "@/components/audiobook/render/voice-api";
import { StoryTimeline } from "@/components/story-timeline";
import type { EditHistory } from "@/hooks/use-edit-history";
import { useTrackDevices } from "@/hooks/use-track-devices";
import { api, type StorySegment } from "@/lib/api";
import { toWav } from "@/lib/audio-file";
import { audiobookApi, type BookDetail, type ChapterWithStats, type Paragraph } from "@/lib/audiobook-api";
import { abk } from "@/lib/audiobook-queries";
import {
  qk,
  useCreateSegment,
  useDeleteSegment,
  useDeleteTrack,
  useInsertTrack,
  useSegments,
  useSplitSegment,
  useTracks,
  useUpdateSegment,
  useUpdateTrack,
} from "@/lib/queries";
import { timelineEdits, type ClipMove } from "@/lib/timeline-edits";

import type { BookOps } from "./use-book-ops";

/** The narration lane. Beds and other sounds go on the lanes below it. */
const NARRATION = 0;

/** Where each paragraph should start when the narration is packed: the same
 *  rule as the server's `layoutChapter`. Unvoiced lines take no time. */
export function packedStarts(
  paragraphs: Pick<Paragraph, "id" | "kind" | "position" | "sound_id" | "duration_s" | "is_heading">[],
  pacing: { paragraph_gap_s: number; heading_gap_s: number },
): Map<string, number> {
  const starts = new Map<string, number>();
  let at = 0;
  for (const p of [...paragraphs].sort((a, b) => a.position - b.position)) {
    if (p.kind === "pause") {
      starts.set(p.id, round3(at));
      at += p.duration_s ?? 0;
      continue;
    }
    if (!p.sound_id) continue;
    starts.set(p.id, round3(at));
    at += (p.duration_s ?? 0) + pacing.paragraph_gap_s + (p.is_heading ? pacing.heading_gap_s : 0);
  }
  return starts;
}

/**
 * The order paragraphs would read in if each dragged clip landed where it was
 * dropped. Only clips with audio (voiced paragraphs and pauses) have a place
 * on the timeline, so a drop is read against those: the paragraph goes just
 * before the first of them whose middle is past the drop point, or after the
 * last. Unvoiced paragraphs keep their places in the text, and an unvoiced
 * clip that gets dragged stays where it is.
 */
export function orderAfterDrop(
  paragraphs: Pick<Paragraph, "id" | "position" | "start_s" | "kind" | "sound_id" | "duration_s">[],
  moves: { id: string; start_s: number }[],
): string[] {
  const reading = [...paragraphs].sort((a, b) => a.position - b.position);
  const placed = reading.filter((p) => p.kind === "pause" || p.sound_id);
  const byId = new Map(placed.map((p) => [p.id, p]));
  const movedIds = new Set(moves.filter((m) => byId.has(m.id)).map((m) => m.id));
  const order = reading.map((p) => p.id);
  for (const move of [...moves].filter((m) => movedIds.has(m.id)).sort((a, b) => a.start_s - b.start_s)) {
    const stay = placed.filter((p) => !movedIds.has(p.id));
    const target = stay.find((p) => p.start_s + (p.duration_s ?? 0) / 2 > move.start_s);
    const anchor = target ?? stay[stay.length - 1];
    if (!anchor) continue;
    order.splice(order.indexOf(move.id), 1);
    const at = order.indexOf(anchor.id);
    order.splice(target ? at : at + 1, 0, move.id);
  }
  // Same order of clips with audio: nothing was really moved, so the text
  // keeps its order rather than shuffling an unvoiced paragraph past one.
  const audible = (ids: string[]) => ids.filter((id) => byId.has(id)).join();
  return audible(order) === audible(reading.map((p) => p.id)) ? reading.map((p) => p.id) : order;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function ChapterTimeline({
  book,
  chapter,
  paragraphs,
  ops,
  history,
  selectedId,
  onSelect,
  onActiveParagraph,
}: {
  book: BookDetail;
  chapter: ChapterWithStats;
  /** The chapter's paragraphs, in reading order. */
  paragraphs: Paragraph[];
  ops: BookOps;
  history: EditHistory;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The paragraph under the playhead while the timeline plays, or null. */
  onActiveParagraph: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const storyId = chapter.story_id;
  const segments = useSegments(storyId);
  const tracks = useTracks(storyId);
  const createSegment = useCreateSegment(storyId);
  const updateSegment = useUpdateSegment(storyId);
  const deleteSegment = useDeleteSegment(storyId);
  const splitSegment = useSplitSegment(storyId);
  const updateTrack = useUpdateTrack(storyId);
  const deleteTrack = useDeleteTrack(storyId);
  const insertTrack = useInsertTrack(storyId);
  const { devices } = useTrackDevices(storyId);

  const lines = useMemo(() => segments.data ?? [], [segments.data]);
  const narration = useMemo(() => new Set(paragraphs.map((p) => p.id)), [paragraphs]);
  const edits = timelineEdits({
    lines,
    tracks: tracks.data,
    history,
    createSegment,
    updateSegment,
    deleteSegment,
    splitSegment,
    updateTrack,
    deleteTrack,
    insertTrack,
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: abk.paragraphs(book.id, chapter.id) });
    void qc.invalidateQueries({ queryKey: qk.segments(storyId) });
  }, [book.id, chapter.id, qc, storyId]);

  const relay = useCallback(async () => {
    try {
      const { moved } = await audiobookApi.layoutChapter(book.id, chapter.id);
      if (moved) refresh();
    } catch {
      // Leaves the clips where they are; the next change tries again.
    }
  }, [book.id, chapter.id, refresh]);

  // Re-pack once whenever the narration stops matching its pacing: after a
  // paragraph is voiced, an undo, a reorder in the text. Keyed on what the
  // layout depends on, so a layout that can't converge isn't retried forever.
  const pacing = book.settings.pacing;
  const signature = useMemo(
    () =>
      paragraphs.map((p) => `${p.id}:${p.position}:${p.kind}:${p.sound_id ?? ""}:${p.duration_s ?? ""}:${p.is_heading}`).join("|") +
      `#${pacing.paragraph_gap_s}/${pacing.heading_gap_s}`,
    [paragraphs, pacing.heading_gap_s, pacing.paragraph_gap_s],
  );
  // The book's events refresh the paragraphs; the timeline reads the same
  // rows as story segments, so follow along whenever they change.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: qk.segments(storyId) });
  }, [qc, signature, storyId]);
  const laidOut = useRef<string | null>(null);
  useEffect(() => {
    if (laidOut.current === signature) return;
    const want = packedStarts(paragraphs, pacing);
    const off = paragraphs.some((p) => want.has(p.id) && Math.abs((want.get(p.id) ?? 0) - p.start_s) > 0.01);
    laidOut.current = signature;
    if (off) void relay();
  }, [pacing, paragraphs, relay, signature]);

  /** A narration clip dragged somewhere: read it as "put this paragraph
   *  here", reorder, and let the chapter re-pack. Other clips move freely. */
  const onMove = (moves: ClipMove[]) => {
    const spoken = moves.filter((m) => narration.has(m.id));
    const free = moves.filter((m) => !narration.has(m.id));
    if (free.length) edits.move(free);
    if (!spoken.length) return;
    const before = [...paragraphs].sort((a, b) => a.position - b.position).map((p) => p.id);
    const after = orderAfterDrop(paragraphs, spoken.map((m) => ({ id: m.id, start_s: m.patch.start_s })));
    if (after.join() === before.join()) {
      // Dropped back into its own slot (or onto another lane): snap back.
      void relay();
      return;
    }
    void ops.reorderParagraphs(chapter.id, before, after).then(relay);
  };

  /** The first lane below the narration, for a sound dropped onto it. */
  const offNarration = (at: { start_s: number; track_index: number }) => ({
    ...at,
    track_index: at.track_index === NARRATION ? 1 : at.track_index,
  });

  const textOnly = (what: string) =>
    toast.info(`${what} a paragraph in the text above`, { description: "The narration lane follows the text." });

  const intoLibrary = async (wav: Blob, name: string, source: string, at: { start_s: number; track_index: number }) => {
    const sound = await api.uploadSound(name, wav, source);
    edits.addClip(source === "recording" ? "record" : "import", {
      sound_id: sound.id,
      speaker: sound.name,
      ...offNarration(at),
    });
    void qc.invalidateQueries({ queryKey: ["sounds"] });
    return sound;
  };

  return (
    <StoryTimeline
      segments={lines}
      selectedId={selectedId}
      onSelect={onSelect}
      onOpenSample={onSelect}
      onActiveSegmentChange={(id) => onActiveParagraph(id && narration.has(id) ? id : null)}
      onMove={onMove}
      onToggleMute={(s: StorySegment) => edits.editClip(s.muted ? "unmute" : "mute", s.id, { muted: !s.muted })}
      onDelete={(ids) => {
        const spoken = paragraphs.filter((p) => ids.includes(p.id));
        if (spoken.length) void ops.remove(spoken);
        const rest = ids.filter((id) => !narration.has(id));
        if (rest.length) edits.removeLines(rest);
      }}
      onDuplicate={(originals) => {
        const rest = originals.filter((s) => !narration.has(s.id));
        if (rest.length < originals.length) textOnly("Duplicate");
        if (rest.length) edits.duplicate(rest);
      }}
      onSplit={(cuts) => {
        const rest = cuts.filter((c) => !narration.has(c.id));
        if (rest.length < cuts.length) textOnly("Split");
        if (rest.length) edits.split(rest);
      }}
      onAddAt={({ start_s, track_index, text }) => {
        if (track_index === NARRATION) return textOnly("Add");
        edits.addClip("add clip", { start_s, track_index, text });
      }}
      onInsertSound={(soundId, { start_s, track_index, name }) =>
        edits.addClip("insert sound", {
          sound_id: soundId,
          ...offNarration({ start_s, track_index }),
          ...(name ? { speaker: name } : {}),
        })
      }
      onPaste={(segment, at) => {
        if (narration.has(segment.id) || at.track_index === NARRATION) return textOnly("Add");
        edits.addClip("paste", {
          text: segment.text,
          speaker: segment.speaker,
          voice_id: segment.voice_id,
          kind: segment.kind,
          sound_id: segment.sound_id,
          duration_s: segment.duration_s,
          ...at,
        });
      }}
      // Through the book, so the voice, model and pronunciations are the
      // book's, and the chapter re-lays when the take lands.
      onRegenerate={(id) => {
        if (!narration.has(id)) return;
        voiceApi.generateParagraph(book.id, id).then(
          () => toast.success("Voicing the paragraph"),
          (err: unknown) => toast.error("Could not start the read", { description: err instanceof Error ? err.message : String(err) }),
        );
      }}
      onFade={(id, patch) => edits.editClip("fade", id, patch)}
      onResize={(id, patch) => edits.editClip("trim", id, patch)}
      onRecorded={async (blob, at) => {
        try {
          const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          await intoLibrary(await toWav(blob), `Take ${stamp}`, "recording", at);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "The recording could not be saved");
        }
      }}
      onImported={async (wav, name, at) => {
        try {
          const sound = await intoLibrary(wav, name || "Imported sound", "import", at);
          toast.success(`Imported ${sound.name}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "That file could not be imported");
        }
      }}
      onOpenPanel={() => toast.info("Open the chapter in the studio for the library and the prompt panels.")}
      undo={history.undo}
      redo={history.redo}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      undoLabel={history.undoLabel}
      generating={new Set()}
      tracks={tracks.data ?? []}
      devices={devices}
      onTrack={edits.editTrack}
      onAddTrack={(trackIndex) => updateTrack.mutate({ trackIndex, patch: {} })}
      onRemoveTrack={(trackIndex) => {
        if (trackIndex === NARRATION) return toast.info("The narration lane stays.");
        // No confirm: undo puts the lane back with its clips.
        edits.removeTrack(trackIndex);
      }}
    />
  );
}
