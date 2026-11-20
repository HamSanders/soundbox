/** Command palette rows for audiobooks: new, import, and one per book. */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import type { Command } from "@/components/command-palette";
import { bookProgress } from "@/lib/audiobook-api";
import { useBooks, useCreateBook } from "@/lib/audiobook-queries";

export function useAudiobookCommands(enabled: boolean): Command[] {
  const navigate = useNavigate();
  const books = useBooks(enabled);
  const create = useCreateBook();
  const createBook = create.mutate;
  return useMemo(
    () => [
      {
        id: "audiobook:new",
        label: "New audiobook",
        keywords: "book narrate audiobook",
        group: "Audiobooks",
        run: () => createBook({}, { onSuccess: (book) => navigate(`/audiobooks/${book.id}`) }),
      },
      {
        id: "audiobook:import",
        label: "Import manuscript…",
        detail: "EPUB, DOCX, PDF, text or a web page",
        keywords: "audiobook book epub docx pdf import manuscript",
        group: "Audiobooks",
        run: () => navigate("/audiobooks?import=1"),
      },
      ...(books.data ?? []).map((book) => ({
        id: `audiobook:${book.id}`,
        label: `Open ${book.title}`,
        detail: `${book.author ?? "Audiobook"} · ${bookProgress(book)}% voiced`,
        keywords: `audiobook book ${book.series ?? ""} ${book.genres.join(" ")}`,
        group: "Audiobooks",
        run: () => navigate(`/audiobooks/${book.id}`),
      })),
    ],
    [books.data, createBook, navigate],
  );
}
