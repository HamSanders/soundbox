/**
 * The bundled public-domain library: short stories, children's stories,
 * novellas and poems to start a book from. Picking one opens it in the import
 * review, like any manuscript. The texts come from Standard Ebooks and ship
 * with Mirli, so this works offline.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, Loader2Icon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

import { importApi, type ClassicSummary } from "./api";

type Form = ClassicSummary["form"] | "all";

const FORMS: { id: Form; label: string }[] = [
  { id: "all", label: "All" },
  { id: "story", label: "Short stories" },
  { id: "children", label: "For children" },
  { id: "novella", label: "Novellas" },
  { id: "poem", label: "Poems" },
];

const FORM_LABEL: Record<ClassicSummary["form"], string> = {
  story: "Short story",
  children: "For children",
  novella: "Novella",
  poem: "Poem",
};

function length(w: ClassicSummary): string {
  const m = w.minutes;
  const t = m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h ${m % 60} min`;
  return w.chapters > 1 ? `${t} · ${w.chapters} chapters` : t;
}

export function ClassicsLibrary({ busy, picking, onPick }: { busy: boolean; picking: string | null; onPick: (id: string) => void }) {
  const library = useQuery({ queryKey: ["audiobooks", "classics"], queryFn: () => importApi.listClassics(), staleTime: Infinity });
  const [form, setForm] = useState<Form>("all");
  const [search, setSearch] = useState("");

  const works = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (library.data?.works ?? []).filter((w) => {
      if (form !== "all" && w.form !== form) return false;
      if (!q) return true;
      return [w.title, w.author, w.translator ?? "", w.description, ...w.genres].some((s) => s.toLowerCase().includes(q));
    });
  }, [library.data, form, search]);

  if (library.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Could not load the library: {errorMessage(library.error)}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Public-domain short stories, poems and novellas, ready to voice. Pick one to review its sections, then cast it like any book.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={form} onValueChange={(v) => setForm(v as Form)}>
          <TabsList className="h-auto flex-wrap">
            {FORMS.map((f) => (
              <TabsTrigger key={f.id} value={f.id}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-56">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            className="pl-8"
            value={search}
            aria-label="Search the classics"
            placeholder="Title, author, genre…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {library.isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : works.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">Nothing in the library matches that.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Classics">
          {works.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(w.id)}
                className={cn(
                  "hover:bg-muted/50 focus-visible:ring-ring flex h-full w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
                  picking === w.id && "border-primary",
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-heading leading-tight font-semibold">{w.title}</span>
                  {picking === w.id && <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" />}
                </span>
                <span className="text-muted-foreground text-xs">
                  {w.author}
                  {w.translator ? `, translated by ${w.translator}` : ""} · {w.year}
                </span>
                <span className="text-foreground/80 line-clamp-2 text-sm">{w.description}</span>
                <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="secondary">{FORM_LABEL[w.form]}</Badge>
                  <span className="text-muted-foreground text-xs">{length(w)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {library.data && (
        <p className="text-muted-foreground text-xs">
          {library.data.rights} Texts from{" "}
          <a href="https://standardebooks.org" target="_blank" rel="noreferrer" className="hover:text-foreground inline-flex items-center gap-0.5 underline">
            Standard Ebooks
            <ExternalLinkIcon className="size-3" />
          </a>
          , whose editions are released under CC0.
        </p>
      )}
    </div>
  );
}
