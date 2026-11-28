/**
 * "New project" at the foot of a project picker: type a name, press Enter,
 * and the new project is created and chosen in one go. A picker that only
 * listed existing projects left anyone with none at a dead end.
 */

import { useState } from "react";
import { FolderPlusIcon } from "@/lib/icons";

import { useCreateProject } from "@/lib/queries";
import type { Project } from "@/lib/api";

export function NewProjectRow({ onCreated }: { onCreated: (project: Project) => void }) {
  const create = useCreateProject();
  const [name, setName] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n || create.isPending) return;
    create.mutate(n, {
      onSuccess: (p) => {
        setName("");
        onCreated(p);
      },
    });
  };
  return (
    <div className="border-border mt-1.5 flex items-center gap-2 border-t px-1.5 pt-1.5">
      <FolderPlusIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="New project…"
        aria-label="New project name"
        disabled={create.isPending}
        className="placeholder:text-muted-foreground h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
      {name.trim() && (
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="bg-primary text-primary-foreground h-7 shrink-0 rounded-full px-2.5 text-xs font-medium"
        >
          {create.isPending ? "Adding…" : "Add"}
        </button>
      )}
    </div>
  );
}
