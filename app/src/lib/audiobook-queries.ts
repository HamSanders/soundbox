/** react-query wiring for audiobooks: keys, reads, mutations and live events. */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "./api";
import {
  audiobookApi,
  type AudiobookEvent,
  type BookDetail,
  type BookNote,
  type BookPatch,
  type BookSummary,
  type ChapterCreate,
  type ChapterPatch,
  type Paragraph,
  type ParagraphCreate,
  type ParagraphPatch,
  type ReplaceRequest,
} from "./audiobook-api";
import { qk } from "./queries";

export const abk = {
  books: ["audiobooks"] as const,
  book: (id: string) => ["audiobook", id] as const,
  paragraphs: (bookId: string, chapterId: string) =>
    ["audiobook", bookId, "paragraphs", chapterId] as const,
  allParagraphs: (bookId: string) => ["audiobook", bookId, "paragraphs"] as const,
  notes: (bookId: string) => ["audiobook", bookId, "notes"] as const,
};

const fail = (what: string) => (err: unknown) => {
  toast.error(what, { description: errorMessage(err) });
};

export function useBooks(enabled = true): UseQueryResult<BookSummary[]> {
  return useQuery({ queryKey: abk.books, queryFn: () => audiobookApi.listBooks(), enabled });
}

export function useBook(id: string | null): UseQueryResult<BookDetail> {
  return useQuery({
    queryKey: abk.book(id ?? ""),
    queryFn: () => audiobookApi.getBook(id!),
    enabled: !!id,
  });
}

export function useParagraphs(bookId: string, chapterId: string | null): UseQueryResult<Paragraph[]> {
  return useQuery({
    queryKey: abk.paragraphs(bookId, chapterId ?? ""),
    queryFn: () => audiobookApi.listParagraphs(bookId, chapterId!),
    enabled: !!chapterId,
  });
}

/**
 * Keep a book's queries fresh from its event stream. Paragraph events
 * refetch that chapter and the book stats; anything else refetches the book.
 * Unknown event types (other areas' progress) also refresh the book, which is
 * cheap and keeps status dots honest while a render runs.
 */
export function useBookEvents(bookId: string | null, onEvent?: (e: AudiobookEvent) => void): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!bookId) return;
    return audiobookApi.subscribe(bookId, (event) => {
      onEvent?.(event);
      if (event.type === "hello") return;
      if (event.type === "notes") {
        void qc.invalidateQueries({ queryKey: abk.notes(bookId) });
      } else if (event.type === "paragraphs" && typeof event.chapter_id === "string") {
        void qc.invalidateQueries({ queryKey: abk.paragraphs(bookId, event.chapter_id) });
      } else if (event.type === "chapters" || event.type === "characters") {
        void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
      }
      void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
      void qc.invalidateQueries({ queryKey: abk.books });
    });
    // onEvent is a callback the caller may recreate per render; the stream
    // should not reconnect for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, qc]);
}

/** Invalidate everything a book shows, plus the shelf. */
function useRefreshBook(bookId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: abk.book(bookId) });
    void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
    void qc.invalidateQueries({ queryKey: abk.books });
  };
}

export function useCreateBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: BookPatch = {}) => audiobookApi.createBook(fields),
    onSuccess: (book) => {
      qc.setQueryData(abk.book(book.id), book);
      void qc.invalidateQueries({ queryKey: abk.books });
    },
    onError: fail("Could not create the book"),
  });
}

export function useUpdateBook(bookId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshBook(bookId);
  return useMutation({
    mutationFn: (patch: BookPatch) => audiobookApi.updateBook(bookId, patch),
    onSuccess: (book) => {
      qc.setQueryData(abk.book(bookId), book);
      refresh();
    },
    onError: fail("Could not save the book"),
  });
}

export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => audiobookApi.deleteBook(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: abk.book(id) });
      void qc.invalidateQueries({ queryKey: abk.books });
      void qc.invalidateQueries({ queryKey: qk.stories });
    },
    onError: fail("Could not delete the book"),
  });
}

export function useUploadCover(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: Blob) => audiobookApi.uploadCover(bookId, file),
    onSuccess: (book) => {
      qc.setQueryData(abk.book(bookId), book);
      void qc.invalidateQueries({ queryKey: abk.books });
    },
    onError: fail("Could not set the cover"),
  });
}

export function useAddChapter(bookId: string) {
  const refresh = useRefreshBook(bookId);
  return useMutation({
    mutationFn: (req: ChapterCreate) => audiobookApi.addChapter(bookId, req),
    onSuccess: refresh,
    onError: fail("Could not add the chapter"),
  });
}

export function useUpdateChapter(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ChapterPatch }) =>
      audiobookApi.updateChapter(bookId, id, patch),
    onMutate: ({ id, patch }) => {
      qc.setQueryData<BookDetail>(abk.book(bookId), (book) =>
        book
          ? { ...book, chapters: book.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
          : book,
      );
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: abk.book(bookId) }),
    onError: fail("Could not update the chapter"),
  });
}

export function useReorderChapters(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => audiobookApi.reorderChapters(bookId, ids),
    onMutate: (ids) => {
      qc.setQueryData<BookDetail>(abk.book(bookId), (book) => {
        if (!book) return book;
        const byId = new Map(book.chapters.map((c) => [c.id, c]));
        return {
          ...book,
          chapters: ids.map((id, i) => ({ ...byId.get(id)!, position: i })).filter((c) => c.id),
        };
      });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: abk.book(bookId) }),
    onError: fail("Could not reorder the chapters"),
  });
}

export function useDeleteChapter(bookId: string) {
  const refresh = useRefreshBook(bookId);
  return useMutation({
    mutationFn: (chapterId: string) => audiobookApi.deleteChapter(bookId, chapterId),
    onSuccess: refresh,
    onError: fail("Could not delete the chapter"),
  });
}

export function useAddParagraph(bookId: string, chapterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ParagraphCreate) => audiobookApi.addParagraph(bookId, chapterId, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: abk.paragraphs(bookId, chapterId) });
      void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
    },
    onError: fail("Could not add the paragraph"),
  });
}

export function useUpdateParagraph(bookId: string, chapterId: string) {
  const qc = useQueryClient();
  const key = abk.paragraphs(bookId, chapterId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ParagraphPatch }) =>
      audiobookApi.updateParagraph(bookId, id, patch),
    onMutate: ({ id, patch }) => {
      qc.setQueryData<Paragraph[]>(key, (list) =>
        list?.map((p) => (p.id === id ? { ...p, ...patch, character_id: "character_id" in patch ? (patch.character_id ?? null) : p.character_id } : p)),
      );
    },
    onSuccess: (paragraph) => {
      qc.setQueryData<Paragraph[]>(key, (list) =>
        list?.map((p) => (p.id === paragraph.id ? paragraph : p)),
      );
      void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: key });
      fail("Could not save the paragraph")(err);
    },
  });
}

export function useDeleteParagraph(bookId: string, chapterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => audiobookApi.deleteParagraph(bookId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: abk.paragraphs(bookId, chapterId) });
      void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
    },
    onError: fail("Could not delete the paragraph"),
  });
}

/** Split, merge and reorder, for one chapter. Each refreshes the chapter
 *  and the book stats when it lands. */
export function useParagraphOps(bookId: string, chapterId: string) {
  const qc = useQueryClient();
  const key = abk.paragraphs(bookId, chapterId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
  };
  const split = useMutation({
    mutationFn: ({ id, at }: { id: string; at: number }) => audiobookApi.splitParagraph(bookId, id, at),
    onSuccess: refresh,
    onError: fail("Could not split the paragraph"),
  });
  const merge = useMutation({
    mutationFn: ({ id, joiner }: { id: string; joiner?: string }) =>
      audiobookApi.mergeWithNext(bookId, id, joiner),
    onSuccess: refresh,
    onError: fail("Could not merge the paragraphs"),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => audiobookApi.reorderParagraphs(bookId, chapterId, ids),
    onMutate: (ids) => {
      qc.setQueryData<Paragraph[]>(key, (list) => {
        if (!list) return list;
        const byId = new Map(list.map((p) => [p.id, p]));
        return ids.map((id, i) => ({ ...byId.get(id)!, position: i })).filter((p) => p.id);
      });
    },
    onSuccess: (list) => qc.setQueryData(key, list),
    onError: (err) => {
      refresh();
      fail("Could not reorder the paragraphs")(err);
    },
  });
  return { split, merge, reorder };
}

export function useCastParagraphs(bookId: string) {
  const refresh = useRefreshBook(bookId);
  return useMutation({
    mutationFn: ({ ids, characterId }: { ids: string[]; characterId: string | null }) =>
      audiobookApi.castParagraphs(bookId, ids, characterId),
    onSuccess: refresh,
    onError: fail("Could not assign the character"),
  });
}

export function useNotes(bookId: string): UseQueryResult<BookNote[]> {
  return useQuery({ queryKey: abk.notes(bookId), queryFn: () => audiobookApi.listNotes(bookId) });
}

export function useNoteOps(bookId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: abk.notes(bookId) });
    void qc.invalidateQueries({ queryKey: abk.book(bookId), exact: true });
  };
  const add = useMutation({
    mutationFn: ({ segmentId, body, atS }: { segmentId: string; body: string; atS?: number | null }) =>
      audiobookApi.addNote(bookId, segmentId, body, atS),
    onSuccess: refresh,
    onError: fail("Could not add the note"),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { body?: string; resolved?: boolean } }) =>
      audiobookApi.updateNote(bookId, id, patch),
    onMutate: ({ id, patch }) => {
      qc.setQueryData<BookNote[]>(abk.notes(bookId), (list) =>
        list?.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      );
    },
    onSettled: refresh,
    onError: fail("Could not update the note"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => audiobookApi.deleteNote(bookId, id),
    onSuccess: refresh,
    onError: fail("Could not delete the note"),
  });
  return { add, update, remove };
}

export function useReplace(bookId: string) {
  const refresh = useRefreshBook(bookId);
  return useMutation({
    mutationFn: (req: ReplaceRequest) => audiobookApi.replace(bookId, req),
    onSuccess: (result) => {
      if (!result.dry_run) refresh();
    },
    onError: fail("Find and replace failed"),
  });
}
