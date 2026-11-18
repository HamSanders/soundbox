/**
 * Create, rename and delete profiles.
 *
 * Its own module because two things open it — the header chip's menu and the
 * command palette — and a dialog that lives inside one of its openers can only
 * ever be opened by that one.
 *
 * See `profile-switcher.tsx` for what a profile is.
 */

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

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
import { useCreateProfile, useDeleteProfile, useRenameProfile } from "@/lib/queries";
import type { Profile } from "@/lib/api";

/** Kept out of the dropdown itself — a menu that switches profile on click
 *  is not a place to also put a delete button. */
export function ProfileManagerDialog({
  open,
  onOpenChange,
  profiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const create = useCreateProfile();
  const rename = useRenameProfile();
  const remove = useDeleteProfile();

  const submitNew = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, { onSuccess: () => setName("") });
  };

  const submitRename = (id: string): void => {
    const trimmed = draft.trim();
    setEditing(null);
    if (!trimmed) return;
    rename.mutate({ id, name: trimmed });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Profiles</DialogTitle>
          <DialogDescription>
            Each profile is its own library — sounds, voices, stories and settings, in its
            own folder. Downloaded models and runtimes are shared, so switching is quick
            and costs no extra disk.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-border divide-y rounded-md border">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center gap-2 px-3 py-2">
              {editing === profile.id ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => submitRename(profile.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename(profile.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="h-8"
                  aria-label="Profile name"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{profile.name}</span>
                    {profile.active && (
                      <span className="label-caps text-muted-foreground border-border rounded border px-1.5 py-0.5">
                        Open
                      </span>
                    )}
                  </div>
                  {/* The folder is the profile, so it is worth showing: it is
                      what you back up, and what you point a second tool at. */}
                  <div className="text-muted-foreground truncate font-mono text-[11px]">
                    {profile.data_dir}
                  </div>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Rename ${profile.name}`}
                onClick={() => {
                  setEditing(profile.id);
                  setDraft(profile.name);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${profile.name}`}
                // The default profile is the data directory itself, and the
                // open one has a live database attached. Both are refused
                // server-side too; this only saves the round trip.
                disabled={profile.id === "default" || profile.active}
                onClick={() => {
                  const alsoData = window.confirm(
                    `Delete "${profile.name}"?\n\nOK also deletes its folder and every sound ` +
                      `in it (${profile.data_dir}).\nCancel just removes it from this list, ` +
                      `leaving the folder on disk.`,
                  );
                  remove.mutate({ id: profile.id, deleteData: alsoData });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>

        <DialogFooter className="sm:justify-start">
          <div className="flex w-full items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="new-profile">New profile</Label>
              <Input
                id="new-profile"
                value={name}
                placeholder="Demo"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                }}
              />
            </div>
            <Button onClick={submitNew} disabled={!name.trim() || create.isPending}>
              <Plus className="size-4" />
              Create
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
