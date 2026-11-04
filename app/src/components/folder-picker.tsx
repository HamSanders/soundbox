/**
 * "Browse…" for a folder path in Settings.
 *
 * Walks the *server's* filesystem, not the browser's. That is not a
 * compromise: the path being chosen is one the server will write to, a browser
 * file input hands back a sandboxed name with no real location, and on a
 * Konchi reached from another machine the local disk is the wrong disk
 * outright. See `GET /api/fs/dirs`.
 *
 * The path field stays editable throughout, and a folder that does not exist
 * yet is a valid choice — the settings patch creates it. Browsing is the
 * shortcut, typing is still the escape hatch.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CornerLeftUpIcon,
  FolderIcon,
  HardDriveIcon,
  HouseIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowseDirectories } from "@/lib/queries";

export function FolderPickerDialog({
  open,
  onOpenChange,
  initialPath,
  title = "Choose a folder",
  description,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to open. The server walks up to the nearest folder that exists, so
   *  a stale or half-typed path is safe to pass. */
  initialPath: string;
  title?: string;
  description?: string;
  onSelect: (path: string) => void;
}) {
  // `browsing` is what the listing follows; `typed` is what the field shows and
  // what Select ultimately returns. They part company as soon as the user
  // edits the field, which is the point — a folder that does not exist yet
  // cannot be browsed to, but it can be typed and created.
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // Reset on each open rather than on mount: the dialog stays mounted between
  // uses, and reopening it on a path the user has since changed should follow
  // the new one.
  useEffect(() => {
    if (!open) return;
    setBrowsing(initialPath || null);
    setTyped(initialPath);
  }, [open, initialPath]);

  const { data, isLoading, isError, error } = useBrowseDirectories(browsing, open);

  // Only meaningful once a listing has arrived — before that we have no
  // separator to build paths with, and no idea what exists.
  const sep = data?.separator ?? "/";
  const atListedFolder = data ? typed === data.path : false;

  function go(path: string) {
    setBrowsing(path);
    setTyped(path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {/* Drives, and home. On Linux and macOS `roots` is a single "/", so
            this row is short rather than absent — one predictable place for
            "start over from the top". */}
        <div className="flex flex-wrap items-center gap-1.5">
          {data && (
            <Button variant="outline" size="sm" onClick={() => go(data.home)}>
              <HouseIcon />
              Home
            </Button>
          )}
          {(data?.roots ?? []).map((root) => (
            <Button
              key={root.path}
              variant={data?.path === root.path ? "secondary" : "outline"}
              size="sm"
              onClick={() => go(root.path)}
            >
              <HardDriveIcon />
              {root.name}
            </Button>
          ))}
        </div>

        <div className="border-border min-h-0 flex-1 rounded-md border">
          <div className="border-border flex items-center gap-2 border-b px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={!data?.parent}
              onClick={() => data?.parent && go(data.parent)}
              aria-label="Go to the parent folder"
            >
              <CornerLeftUpIcon />
              Up
            </Button>
            <p className="text-muted-foreground truncate font-mono text-xs" title={data?.path}>
              {data?.path ?? ""}
            </p>
          </div>

          <ScrollArea className="h-64">
            {isLoading && (
              <div className="space-y-2 p-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-3/5" />
              </div>
            )}
            {isError && (
              <p className="text-muted-foreground p-3 text-sm">
                {error instanceof Error ? error.message : "Could not read that folder"}
              </p>
            )}
            {data && data.entries.length === 0 && (
              <p className="text-muted-foreground p-3 text-sm">
                No folders in here — pick it as it is, or type a name below to create one
                inside it.
              </p>
            )}
            <ul>
              {(data?.entries ?? []).map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none"
                    onClick={() => go(entry.path)}
                  >
                    <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                    <ChevronRightIcon className="text-muted-foreground ml-auto size-4 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="folder-picker-path">Folder</Label>
          <Input
            id="folder-picker-path"
            value={typed}
            className="font-mono text-xs"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              onSelect(typed.trim());
              onOpenChange(false);
            }}
          />
          {/* Only when the field still names the folder we are looking at —
              once it has been edited to somewhere unvisited, the server's
              answer is about the wrong place and would be misleading. */}
          {data && atListedFolder && !data.writable && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              The server may not be able to write here.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!typed.trim()}
            onClick={() => {
              onSelect(typed.trim());
              onOpenChange(false);
            }}
          >
            Use this folder
          </Button>
        </DialogFooter>

        {/* Deliberately last and quiet: creating a subfolder is the uncommon
            case, and the setting itself creates whatever path it is given —
            this only saves the user typing the separator. */}
        {data && (
          <NewSubfolder
            parent={data.path}
            separator={sep}
            onName={(name) => setTyped(joinPath(data.path, name, sep))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Join without assuming our own platform's separator — the server's may not
 *  be ours, and a root already ends in one. */
function joinPath(parent: string, child: string, separator: string): string {
  return parent.endsWith(separator) ? parent + child : parent + separator + child;
}

/**
 * "…and a new folder inside it", as a name rather than a path.
 *
 * No request of its own: it only composes a path into the field above. The
 * folder is created when the setting is saved, which keeps browsing free of
 * side effects — nobody wants a picker that litters empty directories every
 * time it is cancelled.
 */
function NewSubfolder({
  parent,
  separator,
  onName,
}: {
  parent: string;
  separator: string;
  onName: (name: string) => void;
}) {
  const [name, setName] = useState("");

  // A fresh folder each time the listing moves — a name typed for one parent
  // means nothing in the next.
  useEffect(() => setName(""), [parent]);

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="folder-picker-new" className="text-muted-foreground text-xs font-normal">
          New folder in {parent}
        </Label>
        <Input
          id="folder-picker-new"
          value={name}
          placeholder="konchi-sounds"
          className="font-mono text-xs"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !name.trim()) return;
            e.preventDefault();
            onName(name.trim());
          }}
        />
      </div>
      <Button
        variant="outline"
        disabled={!name.trim()}
        onClick={() => onName(name.trim())}
        title={`Use ${joinPath(parent, name.trim() || "…", separator)}`}
      >
        Add
      </Button>
    </div>
  );
}
