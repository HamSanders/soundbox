/**
 * A classic's details in the docked panel (see detail-dock.tsx), opened from
 * its card in Explore. Explore stays beside it, so the next card swaps what
 * it shows.
 *
 * "Add to library" imports the work as it stands (every section, default
 * settings), the same one-click add as the "+" on its card, with Open and
 * Undo on a toast. Once the book exists the panel says so and opens it. The
 * import review with edits lives under Audiobooks → Classics.
 */

import { useQuery } from "@tanstack/react-query";
import { BookPlusIcon, CheckIcon, ExternalLinkIcon, Loader2Icon, XIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { importApi } from "@/components/audiobook/import/api";
import { DockFrame } from "@/components/dock-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDock } from "@/lib/dock";
import { mergeExplore } from "@/lib/listen-explore";
import { useShelf } from "@/lib/listen-queries";

import { lengthLabel } from "./explore-card";
import { ListenCover } from "./listen-cover";
import { useAddClassic } from "./use-add-classic";

const FORM: Record<string, string> = { story: "Short story", children: "For children", novella: "Novella", poem: "Poem" };

export function ClassicDetailPanel({ id }: { id: string }) {
  const close = useDock((s) => s.close);
  const shelf = useShelf();
  // The same query Explore reads, so this is a cache hit from there.
  const library = useQuery({ queryKey: ["audiobooks", "classics"], queryFn: () => importApi.listClassics(), staleTime: Infinity });
  const adder = useAddClassic();

  const items = mergeExplore(shelf.data ?? [], library.data?.works ?? []);
  // Once added, the work is a book on your shelf rather than a classic to add.
  const item = items.find((it) => it.work?.id === id && it.kind === "classic") ?? items.find((it) => it.work?.id === id) ?? null;
  const work = item?.work ?? null;
  const owned = item?.book ?? null;
  const state = item ? adder.stateOf(item) : null;

  const header = (title: string) => (
    <div className="border-border flex items-start gap-2 border-b px-4 pt-4 pb-3">
      <h2 className="font-heading min-w-0 flex-1 text-xl leading-tight font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={close}>
        <XIcon />
      </Button>
    </div>
  );

  if (!item || !work) {
    return (
      <DockFrame label="Classic details" widthId="classic-detail" itemKey={`classic:${id}`}>
        {library.isLoading || shelf.isLoading ? (
          <div className="grid gap-3 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40 w-28" />
          </div>
        ) : (
          <>
            {header("Not found")}
            <p className="text-muted-foreground p-4 text-sm">This classic isn't in the bundled library.</p>
          </>
        )}
      </DockFrame>
    );
  }

  return (
    <DockFrame label={`Details for ${work.title}`} widthId="classic-detail" itemKey={`classic:${id}`}>
      {header(work.title)}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex gap-4">
          <ListenCover
            book={{ title: item.title, author: work.author, cover_url: owned?.cover_url ?? null }}
            className="w-28 shrink-0"
          />
          <div className="min-w-0 space-y-1">
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

        {owned ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground mr-auto flex items-center gap-1.5 text-sm">
              <CheckIcon className="size-4" /> In your library
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/audiobooks/${owned.id}`}>Edit in Audiobooks</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to={`/listen/${owned.id}`}>Open</Link>
            </Button>
          </div>
        ) : (
          <Button className="self-start" disabled={state !== null} onClick={() => adder.add(item)}>
            {state === "adding" ? <Loader2Icon className="animate-spin" /> : state === "added" ? <CheckIcon /> : <BookPlusIcon />}
            {state === "adding" ? "Adding…" : state === "added" ? "In your library" : "Add to library"}
          </Button>
        )}

        <p className="text-foreground/85 text-sm">{work.description}</p>
        <p className="text-muted-foreground text-xs">
          {library.data?.rights}{" "}
          <a
            href={work.source.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground inline-flex items-center gap-0.5 underline"
          >
            Source: {work.source.name}
            <ExternalLinkIcon className="size-3" />
          </a>
        </p>
      </div>
    </DockFrame>
  );
}
