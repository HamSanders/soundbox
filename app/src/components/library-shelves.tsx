/**
 * The Library's browse layer: the type switch, the shelves on the unfiltered
 * page, and the header a project gets when it is opened as a collection.
 *
 * Shaped after the browse pages of music apps (a row of square tiles per
 * shelf, the shelf's name set on each tile, one row and a "Show all"), drawn in
 * the Mirli guide: ink and paper, the title face on the tile, no colour
 * beyond the project tint `ProjectThumb` already uses.
 */

import { Link, NavLink } from "react-router-dom";
import { PlayIcon } from "@/lib/icons";

import { Button } from "@/components/ui/button";
import { ProjectThumb } from "@/components/project-thumb";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/lib/player-store";
import { cn } from "@/lib/utils";
import type { Project, Sound, TagCount } from "@/lib/api";

const KIND_CHIPS = [
  { value: "all", label: "All" },
  { value: "music", label: "Music" },
  { value: "sfx", label: "SFX" },
  { value: "voice", label: "Speech" },
] as const;

export type KindFilter = (typeof KIND_CHIPS)[number]["value"];

/** All / Music / SFX / Speech as a filter on the combined Library. */
export function LibraryKindChips({
  value,
  onChange,
  className,
}: {
  value: KindFilter;
  onChange: (v: KindFilter) => void;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label="Kind" className={cn("border-border flex gap-5 border-b", className)}>
      {KIND_CHIPS.map((c) => (
        <button
          key={c.value}
          type="button"
          role="tab"
          aria-selected={value === c.value}
          onClick={() => onChange(c.value)}
          className={cn(
            "focus-visible:ring-ring/50 -mb-px border-b-2 pb-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2",
            value === c.value
              ? "border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

const LIBRARY_TABS = [
  { to: "/library", label: "Sounds", end: true },
  { to: "/projects", label: "Projects", end: false },
  { to: "/voice/lab", label: "Voices", end: false },
] as const;

/** Sounds / Projects / Voices: the Library's sections, as a music app's
 *  library has Songs / Playlists / Workspaces. */
export function LibraryTabs() {
  return (
    <nav aria-label="Library sections" className="border-border flex gap-5 border-b">
      {LIBRARY_TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "focus-visible:ring-ring/50 -mb-px border-b-2 pb-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2",
              isActive
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Shelf({
  title,
  children,
  more,
}: {
  title: string;
  children: React.ReactNode;
  more?: React.ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-caps text-muted-foreground">{title}</h2>
        {more}
      </div>
      <div className="-mx-1 grid auto-cols-[8.5rem] grid-flow-col gap-3 overflow-x-auto px-1 pb-2">
        {children}
      </div>
    </section>
  );
}

export function ShelfTile({
  name,
  count,
  ...rest
}: { name: string; count: number } & ({ to: string } | { onClick: () => void })) {
  const body = (
    <>
      <span className="relative block aspect-square overflow-hidden rounded-md ring-1 ring-border ring-inset">
        <ProjectThumb name={name} className="size-full [&>span]:hidden" />
        <span className="font-display absolute inset-x-2 bottom-1.5 line-clamp-2 text-lg leading-none font-extrabold tracking-[0.01em] uppercase">
          {name}
        </span>
      </span>
      <span className="readout text-muted-foreground">
        {count} sound{count === 1 ? "" : "s"}
      </span>
    </>
  );
  const cls =
    "focus-visible:ring-ring/50 grid w-full gap-1 rounded-md text-left outline-none focus-visible:ring-3 [&:hover>span:first-child]:ring-border-strong";
  return "to" in rest ? (
    <Link to={rest.to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={rest.onClick} className={cls}>
      {body}
    </button>
  );
}

/** Projects and tags as shelves, above the full list on the unfiltered page. */
export function LibraryShelves({
  projects,
  tags,
  onTag,
  includeEmpty = false,
}: {
  projects: Project[];
  tags: TagCount[];
  /** Filter in place (the Library), or omitted to link to the Library
   *  with the tag chosen (the Dashboard). */
  onTag?: (tag: string) => void;
  /** Show projects with nothing in them yet. The Dashboard does, since a new
   *  project is where you go next; the Library's shelves only list what has
   *  sounds to browse. */
  includeEmpty?: boolean;
}) {
  const withSounds = includeEmpty ? projects : projects.filter((p) => p.sound_count > 0);
  const topTags = [...tags].sort((a, b) => b.count - a.count).slice(0, 12);
  if (withSounds.length === 0 && topTags.length === 0) return null;
  return (
    <div className="grid gap-5">
      {withSounds.length > 0 && (
        <Shelf
          title="Projects"
          more={
            <Link to="/projects" className="decoration-signal text-xs underline decoration-2 underline-offset-4">
              Show all
            </Link>
          }
        >
          {withSounds.map((p) => (
            <ShelfTile key={p.id} name={p.name} count={p.sound_count} to={`/library?project=${p.id}`} />
          ))}
        </Shelf>
      )}
      {topTags.length > 0 && (
        <Shelf title="By tag">
          {topTags.map((t) => (
            onTag ? (
              <ShelfTile key={t.tag} name={t.tag} count={t.count} onClick={() => onTag(t.tag)} />
            ) : (
              <ShelfTile key={t.tag} name={t.tag} count={t.count} to={`/library?tag=${encodeURIComponent(t.tag)}`} />
            )
          ))}
        </Shelf>
      )}
    </div>
  );
}

/** A project opened as a collection: cover, name, a log line and Play. */
export function CollectionHeader({ project, sounds }: { project: Project; sounds: Sound[] }) {
  const play = usePlayerStore((s) => s.play);
  const setSound = usePlayerStore((s) => s.setSound);
  const total = sounds.reduce((sum, s) => sum + (s.duration_s || 0), 0);
  const first = sounds[0];
  return (
    <div className="flex flex-wrap items-end gap-4">
      <ProjectThumb
        name={project.name}
        className="size-28 shrink-0 rounded-md ring-1 ring-border ring-inset [&>span]:text-4xl"
      />
      <div className="grid min-w-0 gap-1.5">
        <span className="label-caps text-muted-foreground">Project</span>
        <h1 className="font-display truncate text-4xl leading-none font-extrabold tracking-[0.01em] uppercase">
          {project.name}
        </h1>
        <span className="readout text-muted-foreground">
          {project.sound_count} sound{project.sound_count === 1 ? "" : "s"}
          {total > 0 && ` · ${formatDuration(total)}`}
        </span>
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            disabled={!first}
            onClick={() => {
              if (!first) return;
              play(first.id);
              setSound(first);
            }}
          >
            <PlayIcon />
            Play
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/projects">All projects</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
