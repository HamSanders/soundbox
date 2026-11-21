/**
 * A classic's details in Explore, with "Add to library": it imports the work
 * as it stands (every section, default settings) and opens the new book in
 * Audiobooks to cast and voice. The import review with edits lives under
 * Audiobooks → Classics; this is the one-click path.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookPlusIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { importApi } from "@/components/audiobook/import/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { abk } from "@/lib/audiobook-queries";
import type { ExploreItem } from "@/lib/listen-explore";
import { lk } from "@/lib/listen-queries";

import { lengthLabel } from "./explore-card";
import { ListenCover } from "./listen-cover";

const FORM: Record<string, string> = { story: "Short story", children: "For children", novella: "Novella", poem: "Poem" };

export function ClassicDialog({ item, rights, onClose }: { item: ExploreItem | null; rights: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const work = item?.work ?? null;

  const add = useMutation({
    mutationFn: async (id: string) => {
      const preview = await importApi.parseClassic(id);
      return importApi.commit({ preview_id: preview.id });
    },
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: abk.books });
      void qc.invalidateQueries({ queryKey: lk.shelf });
      toast.success(`Added “${book.title}” to your library`, { description: "Cast a narrator and voice it here." });
      onClose();
      navigate(`/audiobooks/${book.id}`);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open && !add.isPending) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {item && work && (
          <>
            <DialogHeader>
              <div className="flex gap-4">
                <ListenCover book={{ title: item.title, author: work.author, cover_url: null }} className="w-28" />
                <div className="min-w-0 space-y-1">
                  <DialogTitle className="font-heading text-xl leading-tight">{work.title}</DialogTitle>
                  {work.subtitle && <p className="text-muted-foreground text-sm">{work.subtitle}</p>}
                  <p className="text-sm">
                    {work.author}
                    {work.translator ? `, translated by ${work.translator}` : ""}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    First published {work.year} · {lengthLabel(item)}
                    {work.chapters > 1 ? ` · ${work.chapters} chapters` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="secondary">{FORM[work.form] ?? work.form}</Badge>
                    {work.genres.map((g) => (
                      <Badge key={g} variant="outline">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </DialogHeader>
            <DialogDescription className="text-foreground/85 text-sm">{work.description}</DialogDescription>
            <p className="text-muted-foreground text-xs">
              {rights}{" "}
              <a href={work.source.url} target="_blank" rel="noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5 underline">
                Source: {work.source.name}
                <ExternalLinkIcon className="size-3" />
              </a>
            </p>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
                Close
              </Button>
              <Button onClick={() => add.mutate(work.id)} disabled={add.isPending}>
                {add.isPending ? <Loader2Icon className="animate-spin" /> : <BookPlusIcon />}
                Add to library
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
