/**
 * The clip edits a story timeline makes (add, change, move, delete,
 * duplicate, split, a track's mix, and removing a lane), each recorded as
 * one undo step.
 *
 * Shared by the studio and the audiobook editor's docked timeline, which
 * edit the same thing: a story's segments. Plain functions over the story's
 * mutations rather than a hook, so a caller keeps its own hook order and
 * passes in the mutations it already holds.
 */

import { toast } from "sonner";

import type { EditHistory, EditStep } from "@/hooks/use-edit-history";
import type { SegmentCreate, SegmentPatch, StorySegment, StoryTrack, TrackPatch } from "@/lib/api";
import type {
  useCreateSegment,
  useDeleteSegment,
  useDeleteTrack,
  useInsertTrack,
  useSplitSegment,
  useUpdateSegment,
  useUpdateTrack,
} from "@/lib/queries";

/** The mixer half of a track patch — what the strip on a lane edits and its
 *  undo history records. The device chain has its own path through
 *  `useTrackDevices`, which paces a dial sweep into a few writes. */
export type MixPatch = Omit<TrackPatch, "devices">;

export type ClipMove = { id: string; patch: { start_s: number; track_index: number } };

/** Everything a segment needs to be created again as it was. */
export function restorable(seg: StorySegment): SegmentCreate {
  return {
    text: seg.text,
    speaker: seg.speaker,
    voice_id: seg.voice_id,
    language: seg.language,
    kind: seg.kind,
    sound_id: seg.sound_id,
    duration_s: seg.duration_s,
    track_index: seg.track_index,
    position: seg.position,
    start_s: seg.start_s,
    trim_start_s: seg.trim_start_s,
    fade_in_s: seg.fade_in_s,
    fade_out_s: seg.fade_out_s,
    gain_db: seg.gain_db,
    muted: seg.muted,
    request_options: seg.request_options,
    midi: seg.midi ?? null,
  };
}

export interface TimelineEditDeps {
  lines: StorySegment[];
  tracks: StoryTrack[] | undefined;
  history: EditHistory;
  createSegment: ReturnType<typeof useCreateSegment>;
  updateSegment: ReturnType<typeof useUpdateSegment>;
  deleteSegment: ReturnType<typeof useDeleteSegment>;
  splitSegment: ReturnType<typeof useSplitSegment>;
  updateTrack: ReturnType<typeof useUpdateTrack>;
  deleteTrack: ReturnType<typeof useDeleteTrack>;
  insertTrack: ReturnType<typeof useInsertTrack>;
}

export function timelineEdits({
  lines,
  tracks: trackRows,
  history,
  createSegment,
  updateSegment,
  deleteSegment,
  splitSegment,
  updateTrack,
  deleteTrack,
  insertTrack,
}: TimelineEditDeps) {
  const tracks = { data: trackRows };
  /**
   * Put clips on the timeline, as one edit.
   *
   * One at a time and in order rather than all at once: the server appends
   * each to the script as it arrives, and a batch fired together would be
   * read in whatever order the requests happened to land. Undo deletes them;
   * redo puts the same clips back — same sound, trim and place — under new
   * ids, which every older step is told about.
   */
  const addClips = async (label: string, reqs: SegmentCreate[]): Promise<StorySegment[]> => {
    const created: StorySegment[] = [];
    for (const req of reqs) {
      try {
        created.push(await createSegment.mutateAsync(req));
      } catch {
        // the mutation's own toast says what went wrong
      }
    }
    if (created.length > 0) {
      history.push({
        label: created.length > 1 ? `${label} ${created.length} clips` : label,
        undo: () => created.forEach((clip) => deleteSegment.mutate(history.resolve(clip.id))),
        redo: () => {
          void (async () => {
            for (const clip of created) {
              try {
                const again = await createSegment.mutateAsync(restorable(clip));
                history.remap(history.resolve(clip.id), again.id);
              } catch {
                // the mutation's own toast says what went wrong
              }
            }
          })();
        },
      });
    }
    return created;
  };
  const addClip = (label: string, req: SegmentCreate): void => void addClips(label, [req]);

  /**
   * Change some of a clip's fields — a fade, its gain, a trim, mute — as one
   * edit. What they were is read off the clip as it stands, so the inverse is
   * exactly the fields this touched and nothing an edit since has changed.
   */
  const editClip = (label: string, id: string, patch: SegmentPatch): void => {
    const before = lines.find((l) => l.id === id);
    updateSegment.mutateAsync({ id, patch }).then(
      () => {
        if (!before) return;
        const fields = Object.keys(patch) as (keyof SegmentPatch)[];
        // A cleared length reads back as null, which a patch cannot send;
        // leaving it out keeps whatever the clip has instead.
        const previous = Object.fromEntries(
          fields.map((field) => [field, before[field] ?? undefined]),
        ) as SegmentPatch;
        if (fields.every((field) => previous[field] === patch[field])) return;
        const write = (to: SegmentPatch) => () =>
          updateSegment.mutate({ id: history.resolve(id), patch: to });
        history.push({ label, undo: write(previous), redo: write(patch) });
      },
      () => undefined, // the mutation's own toast says what went wrong
    );
  };

  /**
   * A track's name, mute, solo or volume, as one edit. Lanes are numbers
   * rather than rows the server hands out, so nothing here needs resolving.
   * A volume drag is one step however many writes it took — see `merge`.
   */
  const editTrack = (trackIndex: number, patch: MixPatch): void => {
    const row = tracks.data?.find((t) => t.track_index === trackIndex);
    // A lane with no row is at its defaults.
    const was: Required<MixPatch> = {
      name: row?.name ?? null,
      muted: row?.muted ?? false,
      soloed: row?.soloed ?? false,
      gain_db: row?.gain_db ?? 0,
    };
    const fields = Object.keys(patch) as (keyof MixPatch)[];
    const previous = Object.fromEntries(fields.map((field) => [field, was[field]])) as MixPatch;
    const label =
      patch.name !== undefined
        ? "rename track"
        : patch.muted !== undefined
          ? patch.muted
            ? "mute track"
            : "unmute track"
          : patch.soloed !== undefined
            ? patch.soloed
              ? "solo track"
              : "unsolo track"
            : "track volume";
    updateTrack.mutateAsync({ trackIndex, patch }).then(
      () => {
        if (fields.every((field) => previous[field] === patch[field])) return;
        const write = (to: MixPatch) => () => updateTrack.mutate({ trackIndex, patch: to });
        history.push({
          label,
          undo: write(previous),
          redo: write(patch),
          ...(fields.length === 1 && patch.gain_db !== undefined
            ? { merge: `track-gain-${trackIndex}` }
            : {}),
        });
      },
      () => undefined, // the mutation's own toast says what went wrong
    );
  };

  /**
   * Commit a drag — one clip or a whole selection, as a single edit.
   *
   * Taking the list rather than being called once per clip is what makes a
   * group drag one thing rather than several: a call per clip is an undo
   * entry per clip, so undoing a five-clip drag put them back one at a time,
   * four of them still moved and the arrangement in a state nobody had ever
   * chosen.
   *
   * The script follows on its own. The order things happen in *is* the order
   * they are read in, so the server re-slots a line whenever its clip moves —
   * and the segment cache does the same in the frame the clip lands — which
   * is also what puts the line back when the move is undone.
   */
  const move = (moves: ClipMove[]): void => {
    if (moves.length === 0) return;

    const previous = moves.flatMap(({ id }) => {
      const before = lines.find((l) => l.id === id);
      return before
        ? [{ id, patch: { start_s: before.start_s, track_index: before.track_index } }]
        : [];
    });
    void applyMoves(moves).then((landed) => {
      // Only the clips the server actually moved: undoing one that bounced
      // would put it somewhere it already is.
      const undoable = previous.filter((m) => landed.has(m.id));
      if (undoable.length === 0) return;
      const redoable = moves.filter((m) => landed.has(m.id));
      const resolved = (list: ClipMove[]) => list.map((m) => ({ ...m, id: history.resolve(m.id) }));
      history.push({
        label: undoable.length > 1 ? `move ${undoable.length} clips` : "move",
        undo: () => void applyMoves(resolved(undoable)),
        redo: () => void applyMoves(resolved(redoable)),
      });
    });
  };

  /** The ids the server took. */
  const applyMoves = async (moves: ClipMove[]): Promise<Set<string>> => {
    const results = await Promise.allSettled(moves.map((m) => updateSegment.mutateAsync(m)));
    return new Set(moves.filter((_, i) => results[i]?.status === "fulfilled").map((m) => m.id));
  };

  /**
   * Delete a line, remembering enough to put it back.
   *
   * Restoring creates a new row rather than resurrecting the old one — ids are
   * the server's to hand out — so undo restores the *content* and its place,
   * which is what anyone means by it. The recreated id is captured so a
   * subsequent redo knows what to delete.
   */
  const removeLines = (ids: string[]): void => {
    // In reading order, so putting them back one by one at their old
    // positions rebuilds the order they were in.
    const doomed = ids
      .map((id) => lines.find((l) => l.id === id))
      .filter((l): l is StorySegment => l !== undefined)
      .sort((a, b) => a.position - b.position);
    void Promise.allSettled(ids.map((id) => deleteSegment.mutateAsync(id))).then((results) => {
      const deleted = new Set(ids.filter((_, i) => results[i]?.status === "fulfilled"));
      const gone = doomed.filter((segment) => deleted.has(segment.id));
      if (gone.length === 0) return;

      // One step for the whole selection: deleting five clips and having to
      // press undo five times to get them back is five chances to stop half way.
      history.push({
        label: gone.length > 1 ? `delete ${gone.length} clips` : "delete",
        undo: () => {
          void (async () => {
            for (const segment of gone) {
              try {
                const created = await createSegment.mutateAsync(restorable(segment));
                history.remap(history.resolve(segment.id), created.id);
              } catch {
                // the mutation's own toast says what went wrong
              }
            }
          })();
        },
        redo: () => gone.forEach((segment) => deleteSegment.mutate(history.resolve(segment.id))),
      });
    });
  };
  const removeLine = (id: string): void => removeLines([id]);

  /**
   * Remove a lane and its clips, as one edit, with Undo on a toast.
   *
   * No "are you sure": the audio stays in the library, and undo puts the
   * lane back where it was (the lanes above slide up again) with its name,
   * mix and devices, then recreates its clips in reading order, as an undone
   * clip delete does. Apple's guidance is to avoid alerts for undoable
   * actions, even destructive ones
   * (https://developer.apple.com/design/human-interface-guidelines/alerts).
   */
  const removeTrack = (trackIndex: number): void => {
    const row = tracks.data?.find((t) => t.track_index === trackIndex);
    const settings: TrackPatch = {
      name: row?.name ?? null,
      muted: row?.muted ?? false,
      soloed: row?.soloed ?? false,
      gain_db: row?.gain_db ?? 0,
      devices: row?.devices ?? [],
    };
    const clips = lines
      .filter((l) => l.track_index === trackIndex)
      .sort((a, b) => a.position - b.position);
    deleteTrack.mutateAsync(trackIndex).then(
      () => {
        const step: EditStep = {
          label: "remove track",
          undo: () => {
            void (async () => {
              try {
                await insertTrack.mutateAsync({ trackIndex, patch: settings });
              } catch {
                return; // the mutation's own toast says what went wrong
              }
              for (const clip of clips) {
                try {
                  const created = await createSegment.mutateAsync(
                    restorable({ ...clip, track_index: trackIndex }),
                  );
                  history.remap(history.resolve(clip.id), created.id);
                } catch {
                  // the mutation's own toast says what went wrong
                }
              }
            })();
          },
          redo: () => deleteTrack.mutate(trackIndex),
        };
        history.push(step);
        if (clips.length === 0) return;
        const name = row?.name ?? `Track ${trackIndex}`;
        toast(`Removed ${name} and its ${clips.length} clip${clips.length === 1 ? "" : "s"}`, {
          description: "The audio stays in your library.",
          // As long as `undoable`'s toasts offer Undo.
          duration: 8000,
          action: {
            label: "Undo",
            // Only while it is still the latest edit: undo walks back in order.
            onClick: () => {
              if (history.peek() === step) history.undo();
              else toast.info("Undo the edits after it first (Ctrl+Z).");
            },
          },
        });
      },
      () => undefined, // the mutation's own toast says what went wrong
    );
  };

  const duplicate = (originals: StorySegment[]): void => {
    // Land each copy right after its original in both views, which is where
    // you meant to put it if you are duplicating at all.
    // The whole clip, audio and all: a duplicate that dropped the sound gave
    // you an empty "line" where a copy of the music should have been.
    void addClips(
      "duplicate",
      originals.map((segment) => ({
        ...restorable(segment),
        position: segment.position + 1,
        start_s: segment.start_s + (segment.duration_s ?? 0),
      })),
    );
  };

  /**
   * Cut clips in two at a point inside each, as one edit.
   *
   * The server renders both halves as new sounds and keeps the first half on
   * the original clip. Undo is the reverse without re-rendering anything: the
   * tail goes and the head is pointed back at the whole take, trimmed and
   * faded as it was. Redo reuses the
   * halves the first cut made rather than cutting again, which would leave
   * another pair of derived sounds in the library every time.
   */
  const split = (cuts: { id: string; atS: number }[]): void => {
    if (cuts.length === 0) return;
    void Promise.allSettled(
      cuts.map(async ({ id, atS }) => {
        const before = lines.find((l) => l.id === id);
        const [head, tail] = await splitSegment.mutateAsync({ id, atS });
        return before && head && tail ? { before, head, tail } : null;
      }),
    ).then((results) => {
      const done = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
      if (done.length === 0) return;
      // Which take the clip plays, how much of it, and from where. The split
      // moves the trim and the fade out too: the head's new take starts at
      // the old in-point, and the fade out went to the tail.
      const point = (id: string, at: StorySegment): void =>
        updateSegment.mutate({
          id: history.resolve(id),
          patch: {
            sound_id: at.sound_id ?? null,
            duration_s: at.duration_s ?? undefined,
            trim_start_s: at.trim_start_s,
            fade_out_s: at.fade_out_s,
          },
        });
      history.push({
        label: done.length > 1 ? `split ${done.length} clips` : "split",
        undo: () =>
          done.forEach(({ before, tail }) => {
            deleteSegment.mutate(history.resolve(tail.id));
            point(before.id, before);
          }),
        redo: () =>
          done.forEach(({ before, head, tail }) => {
            point(before.id, head);
            createSegment.mutateAsync(restorable(tail)).then(
              (again) => history.remap(history.resolve(tail.id), again.id),
              () => undefined, // the mutation's own toast says what went wrong
            );
          }),
      });
    });
  };

  return { addClips, addClip, editClip, editTrack, move, applyMoves, removeLines, removeLine, removeTrack, duplicate, split };
}
