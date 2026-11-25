/**
 * Add a classic to the library in one click, from anywhere in Explore.
 *
 * You stay where you are: the card shows "In library" at once, and a toast
 * offers Open (go to the new book in Audiobooks) and Undo (delete it again;
 * it has no audio yet, so nothing is lost and nothing needs confirming).
 * ElevenLabs' Voice Library saves a voice the same way, with a "+" that
 * doesn't take you out of the library
 * (https://elevenlabs.io/docs/eleven-creative/voices/voice-library).
 *
 * Where each add stands is shared, so a card and the classic's details panel
 * show the same thing whichever one started it.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { create } from "zustand";

import { importApi } from "@/components/audiobook/import/api";
import { errorMessage } from "@/lib/api";
import { audiobookApi } from "@/lib/audiobook-api";
import { abk } from "@/lib/audiobook-queries";
import type { ExploreItem } from "@/lib/listen-explore";
import { lk } from "@/lib/listen-queries";
import { reversible } from "@/lib/undo";

export type AddState = "adding" | "added";

/** Work id → where its add stands, until the shelf refetch shows the book. */
const useAddStates = create<{ states: Record<string, AddState> }>(() => ({ states: {} }));

function mark(id: string, s: AddState | null) {
  useAddStates.setState((cur) => {
    const { [id]: _old, ...rest } = cur.states;
    return { states: s ? { ...rest, [id]: s } : rest };
  });
}

export function useAddClassic() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const states = useAddStates((s) => s.states);
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: abk.books }), qc.invalidateQueries({ queryKey: lk.shelf })]);

  const add = (item: ExploreItem) => {
    const work = item.work;
    if (!work || states[work.id]) return;
    mark(work.id, "adding");
    void reversible({
      run: async () => {
        const preview = await importApi.parseClassic(work.id);
        return importApi.commit({ preview_id: preview.id });
      },
      message: (book) => `Added “${book.title}” to your library`,
      description: "Cast a narrator and voice it in Audiobooks.",
      open: { label: "Open", onClick: (book) => navigate(`/audiobooks/${book.id}`) },
      undo: async (book) => {
        await audiobookApi.deleteBook(book.id, true);
        mark(work.id, null);
        await refresh();
      },
      undone: `Removed “${work.title}”`,
      failure: "Couldn't remove it again",
    }).then(
      async () => {
        mark(work.id, "added");
        await refresh();
        // The shelf now lists the book itself, which replaces the classic's card.
        mark(work.id, null);
      },
      (err) => {
        mark(work.id, null);
        toast.error(`Couldn't add “${work.title}”`, { description: errorMessage(err) });
      },
    );
  };

  return { add, stateOf: (item: ExploreItem): AddState | null => (item.work ? (states[item.work.id] ?? null) : null) };
}
