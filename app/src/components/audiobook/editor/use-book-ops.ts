/**
 * Book edits that can be undone: text, casting, lock, paragraph and chapter
 * order, split and merge, insert and delete.
 *
 * Each operation calls the API, and only once the server has taken it
 * pushes a step onto the shared `useEditHistory` stack. Steps act on ids
 * through `history.resolve`, because undoing a delete or a merge brings a
 * paragraph back under a new id; `history.remap` records that.
 */

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { EditHistory } from "@/hooks/use-edit-history";
import { errorMessage } from "@/lib/api";
import { audiobookApi, type BookDetail, type Paragraph } from "@/lib/audiobook-api";
import { abk } from "@/lib/audiobook-queries";

export interface BookOps {
  setText: (p: Paragraph, text: string) => Promise<void>;
  cast: (paragraphs: Paragraph[], characterId: string | null) => Promise<void>;
  setLocked: (paragraphs: Paragraph[], locked: boolean) => Promise<void>;
  split: (p: Paragraph, text: string, at: number) => Promise<Paragraph | null>;
  mergeNext: (p: Paragraph) => Promise<void>;
  insert: (
    chapterId: string,
    after: Paragraph | null,
    kind: "line" | "pause",
  ) => Promise<Paragraph | null>;
  remove: (paragraphs: Paragraph[]) => Promise<void>;
  reorderParagraphs: (chapterId: string, before: string[], after: string[]) => Promise<void>;
  reorderChapters: (before: string[], after: string[]) => Promise<void>;
}

export function useBookOps(bookId: string, history: EditHistory): BookOps {
  const qc = useQueryClient();

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: abk.book(bookId) });
    void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
    void qc.invalidateQueries({ queryKey: abk.books });
  }, [bookId, qc]);

  /** Run `fn`, refresh, and report a failure. Returns null on failure. */
  const run = useCallback(
    async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        toast.error(what, { description: errorMessage(err) });
        return null;
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const api = audiobookApi;
  const r = history.resolve;

  return useMemo<BookOps>(() => {
    const setText = async (p: Paragraph, text: string) => {
      const before = p.text;
      if (before === text) return;
      const ok = await run("Could not save the paragraph", () =>
        api.updateParagraph(bookId, p.id, { text }),
      );
      if (!ok) return;
      history.push({
        label: "edit text",
        undo: () => void run("Undo failed", () => api.updateParagraph(bookId, r(p.id), { text: before })),
        redo: () => void run("Redo failed", () => api.updateParagraph(bookId, r(p.id), { text })),
      });
    };

    const castMany = (pairs: [string, string | null][]) =>
      Promise.all(
        // Grouped by target character: one request each.
        [...new Set(pairs.map(([, c]) => c))].map((c) =>
          api.castParagraphs(
            bookId,
            pairs.filter(([, x]) => x === c).map(([id]) => r(id)),
            c,
          ),
        ),
      );

    const cast = async (paragraphs: Paragraph[], characterId: string | null) => {
      if (paragraphs.length === 0) return;
      const before = paragraphs.map((p) => [p.id, p.character_id] as [string, string | null]);
      const ids = paragraphs.map((p) => p.id);
      const ok = await run("Could not assign the character", () =>
        api.castParagraphs(bookId, ids, characterId),
      );
      if (!ok) return;
      history.push({
        label: "cast",
        undo: () => void run("Undo failed", () => castMany(before)),
        redo: () =>
          void run("Redo failed", () => api.castParagraphs(bookId, ids.map(r), characterId)),
      });
    };

    const setLockedMany = (ids: string[], locked: boolean) =>
      Promise.all(ids.map((id) => api.updateParagraph(bookId, r(id), { locked })));

    const setLocked = async (paragraphs: Paragraph[], locked: boolean) => {
      const ids = paragraphs.filter((p) => p.locked !== locked).map((p) => p.id);
      if (ids.length === 0) return;
      const ok = await run("Could not change the lock", () => setLockedMany(ids, locked));
      if (!ok) return;
      history.push({
        label: locked ? "lock" : "unlock",
        undo: () => void run("Undo failed", () => setLockedMany(ids, !locked)),
        redo: () => void run("Redo failed", () => setLockedMany(ids, locked)),
      });
    };

    const split = async (p: Paragraph, text: string, at: number) => {
      const before = p.text;
      const result = await run("Could not split the paragraph", async () => {
        if (text !== p.text) await api.updateParagraph(bookId, p.id, { text });
        return api.splitParagraph(bookId, p.id, at);
      });
      if (!result) return null;
      let secondId = result.second.id;
      history.push({
        label: "split",
        undo: () =>
          void run("Undo failed", async () => {
            await api.mergeWithNext(bookId, r(p.id));
            if (text !== before) await api.updateParagraph(bookId, r(p.id), { text: before });
          }),
        redo: () =>
          void run("Redo failed", async () => {
            if (text !== before) await api.updateParagraph(bookId, r(p.id), { text });
            const again = await api.splitParagraph(bookId, r(p.id), at);
            history.remap(secondId, again.second.id);
            secondId = again.second.id;
          }),
      });
      return result.second;
    };

    const mergeNext = async (p: Paragraph) => {
      // What the second paragraph was, so undo can put it back as it was.
      const list = qc.getQueryData<Paragraph[]>(abk.paragraphs(bookId, p.chapter_id)) ?? [];
      const next = list[list.findIndex((x) => x.id === p.id) + 1] ?? null;
      const result = await run("Could not merge the paragraphs", () => api.mergeWithNext(bookId, p.id));
      if (!result) return;
      let removedId = result.removed_id;
      const restore = async () => {
        const back = await api.splitParagraph(bookId, r(p.id), result.split_at);
        history.remap(removedId, back.second.id);
        removedId = back.second.id;
        if (next && (next.character_id !== back.second.character_id || next.is_heading)) {
          await api.updateParagraph(bookId, back.second.id, {
            character_id: next.character_id,
            is_heading: next.is_heading,
          });
        }
      };
      history.push({
        label: "merge",
        undo: () => void run("Undo failed", restore),
        redo: () => void run("Redo failed", () => api.mergeWithNext(bookId, r(p.id))),
      });
    };

    const recreate = async (chapterId: string, p: Paragraph): Promise<Paragraph> => {
      const made = await api.addParagraph(bookId, chapterId, {
        text: p.text,
        kind: p.kind,
        duration_s: p.kind === "pause" ? p.duration_s : null,
        position: p.position,
        character_id: p.character_id,
        is_heading: p.is_heading,
      });
      history.remap(p.id, made.id);
      return made;
    };

    const insert = async (chapterId: string, after: Paragraph | null, kind: "line" | "pause") => {
      const made = await run("Could not add the paragraph", () =>
        api.addParagraph(bookId, chapterId, {
          text: "",
          kind,
          duration_s: kind === "pause" ? 1 : null,
          position: after ? after.position + 1 : null,
        }),
      );
      if (!made) return null;
      let id = made.id;
      history.push({
        label: kind === "pause" ? "add pause" : "add paragraph",
        undo: () => void run("Undo failed", () => api.deleteParagraph(bookId, r(id))),
        redo: () =>
          void run("Redo failed", async () => {
            const again = await recreate(chapterId, { ...made, id });
            id = again.id;
          }),
      });
      return made;
    };

    const remove = async (paragraphs: Paragraph[]) => {
      const doomed = paragraphs.filter((p) => !p.locked).sort((a, b) => a.position - b.position);
      if (doomed.length === 0) return;
      const ok = await run("Could not delete", () =>
        Promise.all(doomed.map((p) => api.deleteParagraph(bookId, p.id))),
      );
      if (!ok) return;
      // Ids change on every restore; keep the latest for the next redo.
      let current = doomed.map((p) => ({ ...p }));
      history.push({
        label: doomed.length === 1 ? "delete paragraph" : `delete ${doomed.length} paragraphs`,
        undo: () =>
          void run("Undo failed", async () => {
            const back: Paragraph[] = [];
            // In reading order, so each lands at its old position.
            for (const p of current) back.push(await recreate(p.chapter_id, p));
            current = current.map((p, i) => ({ ...p, id: back[i]!.id }));
          }),
        redo: () =>
          void run("Redo failed", () =>
            Promise.all(current.map((p) => api.deleteParagraph(bookId, r(p.id)))),
          ),
      });
    };

    const reorderParagraphs = async (chapterId: string, before: string[], after: string[]) => {
      const ok = await run("Could not reorder the paragraphs", () =>
        api.reorderParagraphs(bookId, chapterId, after),
      );
      if (!ok) return;
      history.push({
        label: "reorder paragraphs",
        undo: () =>
          void run("Undo failed", () => api.reorderParagraphs(bookId, chapterId, before.map(r))),
        redo: () =>
          void run("Redo failed", () => api.reorderParagraphs(bookId, chapterId, after.map(r))),
      });
    };

    const reorderChapters = async (before: string[], after: string[]) => {
      // Optimistic, so a drag lands at once.
      qc.setQueryData<BookDetail>(abk.book(bookId), (book) => {
        if (!book) return book;
        const byId = new Map(book.chapters.map((c) => [c.id, c]));
        return { ...book, chapters: after.flatMap((id, i) => (byId.has(id) ? [{ ...byId.get(id)!, position: i }] : [])) };
      });
      const ok = await run("Could not reorder the chapters", () => api.reorderChapters(bookId, after));
      if (!ok) return;
      history.push({
        label: "reorder chapters",
        undo: () => void run("Undo failed", () => api.reorderChapters(bookId, before)),
        redo: () => void run("Redo failed", () => api.reorderChapters(bookId, after)),
      });
    };

    return { setText, cast, setLocked, split, mergeNext, insert, remove, reorderParagraphs, reorderChapters };
  }, [api, bookId, history, qc, r, run]);
}
