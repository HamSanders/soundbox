/** react-query wiring for the listening side. */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "./api";
import { listenApi } from "./listen-api";
import { onProgressSaved, useListenPlayer } from "./listen-player-store";
import type { AudioEncoding, Bookmark, ChecklistTarget, ListenManifest, RssRequest, ShelfBook } from "./listen-types";

export const lk = {
  shelf: ["listen", "shelf"] as const,
  manifest: (id: string) => ["listen", "manifest", id] as const,
  checklist: (id: string) => ["listen", "checklist", id] as const,
};

const fail = (what: string) => (err: unknown) => {
  toast.error(what, { description: errorMessage(err) });
};

export function useShelf(): UseQueryResult<ShelfBook[]> {
  useLiveProgress();
  // Progress changes while you listen elsewhere; always refetch on return.
  return useQuery({ queryKey: lk.shelf, queryFn: () => listenApi.shelf(), staleTime: 0, refetchOnMount: "always" });
}

/**
 * Keep cached progress current while the player runs: every save the player
 * makes is written into the shelf and that book's manifest in place, so
 * "Continue listening", the progress bars and Resume move without a refetch.
 */
export function useLiveProgress(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      onProgressSaved((progress) => {
        qc.setQueryData<ShelfBook[]>(lk.shelf, (list) =>
          list?.map((b) => (b.id === progress.book_id ? { ...b, progress } : b)),
        );
        qc.setQueryData<ListenManifest>(lk.manifest(progress.book_id), (m) => (m ? { ...m, progress } : m));
      }),
    [qc],
  );
}

export function useListenManifest(id: string | null): UseQueryResult<ListenManifest> {
  useLiveProgress();
  return useQuery({
    queryKey: lk.manifest(id ?? ""),
    queryFn: () => listenApi.manifest(id!),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useChecklist(id: string | null, enabled = true): UseQueryResult<ChecklistTarget[]> {
  return useQuery({
    queryKey: lk.checklist(id ?? ""),
    queryFn: () => listenApi.checklist(id!),
    enabled: !!id && enabled,
  });
}

/** Bookmarks live on the manifest; mutations update it and the open player. */
export function useBookmarkMutations(bookId: string) {
  const qc = useQueryClient();
  const sync = (update: (list: Bookmark[]) => Bookmark[]) => {
    qc.setQueryData<ListenManifest>(lk.manifest(bookId), (m) => (m ? { ...m, bookmarks: update(m.bookmarks) } : m));
    const player = useListenPlayer.getState();
    if (player.manifest?.book.id === bookId) player.setBookmarks(update(player.manifest.bookmarks));
  };
  const add = useMutation({
    mutationFn: (req: { chapter_id: string; position_s: number; segment_id?: string | null; note?: string }) =>
      listenApi.addBookmark(bookId, req),
    onSuccess: (mark) => sync((list) => [...list, mark]),
    onError: fail("Could not add the bookmark"),
  });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; note?: string; position_s?: number }) =>
      listenApi.updateBookmark(bookId, id, patch),
    onSuccess: (mark) => sync((list) => list.map((b) => (b.id === mark.id ? mark : b))),
    onError: fail("Could not save the note"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => listenApi.deleteBookmark(bookId, id).then(() => id),
    onSuccess: (id) => sync((list) => list.filter((b) => b.id !== id)),
    onError: fail("Could not delete the bookmark"),
  });
  return { add, update, remove };
}

export function useMarkFinished(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (finished: boolean): Promise<void> => {
      if (finished) await listenApi.saveProgress(bookId, { chapter_id: null, position_s: 0, finished: true });
      else await listenApi.clearProgress(bookId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lk.shelf });
      void qc.invalidateQueries({ queryKey: lk.manifest(bookId) });
    },
    onError: fail("Could not update the book"),
  });
}

export function useSetTags(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => listenApi.setTags(bookId, tags),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lk.shelf });
      void qc.invalidateQueries({ queryKey: lk.manifest(bookId) });
    },
    onError: fail("Could not save tags"),
  });
}

export function usePublishWebPlayer(bookId: string) {
  return useMutation({
    mutationFn: (req: { encoding?: AudioEncoding }) => listenApi.publishWebPlayer(bookId, req),
    onError: fail("Could not export the web player"),
  });
}

export function usePublishRss(bookId: string) {
  return useMutation({
    mutationFn: (req: RssRequest) => listenApi.publishRss(bookId, req),
    onError: fail("Could not export the podcast feed"),
  });
}
