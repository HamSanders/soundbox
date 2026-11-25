/** Projects — every project, as a list, with the sidebar's create/delete moved in here too. */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderIcon, FolderPlusIcon, Trash2Icon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ShelfTile } from "@/components/library-shelves";

import { SearchInput } from "@/components/search-input";
import { useCreateProject, useDeleteProject, useProjects } from "@/lib/queries";
import type { Project } from "@/lib/api";

export function ProjectsPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading, isError, error } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [query, setQuery] = useState("");

  // Client-side: the whole list is already here (there is no paged projects
  // endpoint), so a round trip per keystroke would buy nothing.
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? (projects ?? []).filter((p) => p.name.toLowerCase().includes(needle))
    : (projects ?? []);

  const commitCreate = () => {
    const name = draftName.trim();
    setCreating(false);
    setDraftName("");
    if (!name) return;
    createProject.mutate(name);
  };

  const open = (project: Project) => navigate(`/library?project=${encodeURIComponent(project.id)}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm">
            {projects ? `${projects.length} project${projects.length === 1 ? "" : "s"}` : " "}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <FolderPlusIcon />
          New project
        </Button>
      </div>

      {/* Only once there are enough to be worth filtering — a search box over
          three projects is chrome. */}
      {(projects?.length ?? 0) > 5 && (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search projects…"
          className="max-w-sm"
        />
      )}

      {creating && (
        <Input
          autoFocus
          value={draftName}
          placeholder="Project name"
          aria-label="New project name"
          className="max-w-sm"
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitCreate}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCreate();
            if (e.key === "Escape") {
              setDraftName("");
              setCreating(false);
            }
          }}
        />
      )}

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState tone="error" title="Could not load projects">
          {error instanceof Error ? error.message : "Unknown error"}
        </EmptyState>
      ) : !shown.length ? (
        <EmptyState
          icon={FolderIcon}
          title={needle ? "No projects match that" : "No projects yet"}
        >
          {needle
            ? "Try a different name, or clear the search."
            : "Projects group sounds and sessions together — create one to get started."}
        </EmptyState>
      ) : (
        /* The same square tiles as the Library and Dashboard shelves, laid
           out as a wrapping grid: a project reads as a collection to open,
           not a folder row. Delete shows on hover, as before. */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4">
          {shown.map((p, i) => (
            <div
              key={p.id}
              className="group animate-in fade-in-0 slide-in-from-bottom-1 relative duration-300 fill-mode-both"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <ShelfTile name={p.name} count={p.sound_count} onClick={() => open(p)} />
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={`Delete project ${p.name}`}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 no-hover:opacity-100"
                onClick={() => setPendingDelete(p)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this project?</DialogTitle>
            <DialogDescription>
              {pendingDelete && (
                <>
                  &ldquo;{pendingDelete.name}&rdquo; will be removed. The {pendingDelete.sound_count}{" "}
                  sound{pendingDelete.sound_count === 1 ? "" : "s"} in it stay in the library, just
                  unfiled.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteProject.isPending}
              onClick={() => {
                if (!pendingDelete) return;
                deleteProject.mutate(pendingDelete.id, {
                  onSuccess: () => setPendingDelete(null),
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
