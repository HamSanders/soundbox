/**
 * A classic's details in Explore, with "Add to library": it imports the work
 * as it stands (every section, default settings), the same one-click add as
 * the "+" on its card, so you stay in Explore with Open and Undo on a toast.
 * The import review with edits lives under Audiobooks → Classics.
 */

import { BookPlusIcon, ExternalLinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ExploreItem } from "@/lib/listen-explore";

import { lengthLabel } from "./explore-card";
import { ListenCover } from "./listen-cover";
import type { useAddClassic } from "./use-add-classic";

const FORM: Record<string, string> = { story: "Short story", children: "For children", novella: "Novella", poem: "Poem" };

export function ClassicDialog({
  item,
  rights,
  adder,
  onClose,
}: {
  item: ExploreItem | null;
  rights: string | null;
  adder: ReturnType<typeof useAddClassic>;
  onClose: () => void;
}) {
  const work = item?.work ?? null;

  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose();
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
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  adder.add(item);
                  onClose();
                }}
              >
                <BookPlusIcon />
                Add to library
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
