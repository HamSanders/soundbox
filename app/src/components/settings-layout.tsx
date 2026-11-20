/**
 * The Settings page's chrome: search, a sticky section nav, group cards and
 * the one row shape every setting uses.
 *
 * One scrolling page of grouped cards (the Vercel/GitHub shape) rather than
 * one pane per group: half the groups are two or three rows, and the ones
 * people set together are related. The search box filters rows in place, so
 * a match is always shown inside its group card, with the group as context.
 *
 * Each row answers the same four questions in the same places: what is this
 * (label, one line), what is it set to (control, right), did my change take
 * ("Saved", quietly, next to the control), and is it still the default
 * ("Changed", with a reset beside it).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, RotateCcwIcon, SearchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage, type SettingsPatch } from "@/lib/api";
import { afterSettingsSaved, qk, useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";

import {
  SETTINGS,
  SETTINGS_GROUPS,
  matchesQuery,
  settingAllowed,
  settingMeta,
} from "@/components/settings-index";

// ------------------------------------------------------------------ context

interface SettingsUi {
  /** False for a row this server doesn't let its user change. */
  allowed: (id: string) => boolean;
  query: string;
  setQuery: (q: string) => void;
  saved: ReadonlySet<string>;
  markSaved: (id: string) => void;
  flash: string | null;
}

const Ctx = createContext<SettingsUi | null>(null);

function useSettingsUi(): SettingsUi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Settings rows must sit inside <SettingsLayout>");
  return ctx;
}

/** Shows a row's "Saved" for this long after its change lands. */
const SAVED_MS = 2000;

/**
 * Save a settings patch on behalf of one row.
 *
 * Its own mutation rather than `useUpdateSettings`: that one toasts "Settings
 * saved" for the whole app, and a toast per toggle is noise when the row can
 * say it right where you clicked. Failures still toast — a failure is worth
 * interrupting for.
 */
export function useSettingSave() {
  const qc = useQueryClient();
  const { markSaved } = useSettingsUi();
  const m = useMutation({
    mutationFn: ({ patch }: { id: string; patch: SettingsPatch }) => api.updateSettings(patch),
    onSuccess: (next, { id, patch }) => {
      qc.setQueryData(qk.settings, next);
      afterSettingsSaved(qc, patch);
      markSaved(id);
    },
    onError: (err) => toast.error("Could not save settings", { description: errorMessage(err) }),
  });
  return {
    pending: m.isPending,
    save: (id: string, patch: SettingsPatch, opts?: { onSuccess?: () => void; onError?: () => void }) =>
      m.mutate({ id, patch }, opts),
  };
}

/** For settings stored in the browser: no round trip, but the same "Saved". */
export function useMarkSaved() {
  return useSettingsUi().markSaved;
}

// ------------------------------------------------------------------- layout

export function SettingsLayout({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [active, setActive] = useState<string>(SETTINGS_GROUPS[0]!.id);
  const timers = useRef(new Map<string, number>());
  const searchRef = useRef<HTMLInputElement>(null);
  const [params] = useSearchParams();
  const deepLink = params.get("s");

  const markSaved = useCallback((id: string) => {
    setSaved((prev) => new Set(prev).add(id));
    const old = timers.current.get(id);
    if (old) window.clearTimeout(old);
    timers.current.set(
      id,
      window.setTimeout(() => {
        setSaved((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, SAVED_MS),
    );
  }, []);

  // Ctrl/Cmd+K and "/" focus the search. The command palette stands down on
  // this page so the shortcut means "search settings" here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      const modK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
      if (modK || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // `#/settings?s=<id>`: scroll to the row and mark it for a moment. Waits a
  // frame so cards that render after settings load are in the DOM.
  useEffect(() => {
    if (!deepLink) return;
    setQuery("");
    let tries = 0;
    let raf = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(deepLink)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlash(deepLink);
        window.setTimeout(() => setFlash(null), 2400);
      } else if (tries++ < 60) {
        raf = requestAnimationFrame(find);
      }
    };
    raf = requestAnimationFrame(find);
    return () => cancelAnimationFrame(raf);
  }, [deepLink]);

  const can = useCan();
  const allowed = useCallback((id: string) => settingAllowed(id, can), [can]);
  const matches = useMemo(
    () => SETTINGS.filter((s) => allowed(s.id) && matchesQuery(s, query)),
    [query, allowed],
  );
  // Groups with nothing this server allows are left out of the nav entirely,
  // not greyed out like a group the search has emptied.
  const groups = SETTINGS_GROUPS.filter((g) => SETTINGS.some((s) => s.group === g.id && allowed(s.id)));
  const visibleGroups = groups.filter((g) => matches.some((m) => m.group === g.id));
  const searching = query.trim() !== "";

  // Highlight the group the reader is in (top band of the viewport).
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.replace(/^group-/, ""));
      },
      { rootMargin: "-10% 0px -60% 0px", threshold: 0 },
    );
    for (const g of visibleGroups) {
      const el = document.getElementById(`group-${g.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // Re-observe when the visible set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroups.map((g) => g.id).join(",")]);

  const jump = (id: string) => {
    document.getElementById(`group-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  const ctx = useMemo<SettingsUi>(
    () => ({ allowed, query, setQuery, saved, markSaved, flash }),
    [allowed, query, saved, markSaved, flash],
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className="mx-auto flex w-full max-w-5xl justify-center gap-8">
        <nav aria-label="Settings groups" className="hidden w-44 shrink-0 lg:block">
          <div className="sticky top-20 space-y-0.5">
            {groups.map((g) => {
              const shown = visibleGroups.includes(g);
              return (
                <a
                  key={g.id}
                  href={`#/settings`}
                  onClick={(e) => {
                    // Hash router: a bare #id would be read as a route change.
                    e.preventDefault();
                    if (shown) jump(g.id);
                  }}
                  aria-disabled={!shown || undefined}
                  aria-current={active === g.id ? "true" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    !shown && "pointer-events-none opacity-40",
                    g.danger && "mt-3",
                    active === g.id && shown
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {g.title}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="w-full min-w-0 max-w-3xl space-y-6">
          <header className="space-y-3">
            <div>
              <h1 className="font-display text-3xl uppercase">Settings</h1>
              <p className="text-muted-foreground text-sm">
                Stored locally alongside your sounds. Changes save as you make them.
              </p>
            </div>
            <div className="bg-background/90 sticky top-14 z-10 -mx-1 space-y-2 px-1 py-2 backdrop-blur lg:top-16">
              <div className="relative">
                <SearchIcon
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  ref={searchRef}
                  type="text"
                  role="searchbox"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuery("");
                  }}
                  placeholder="Search settings"
                  aria-label="Search settings"
                  className="h-10 pr-20 pl-9"
                />
                <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
                  {searching ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Clear search"
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    >
                      <XIcon />
                    </Button>
                  ) : (
                    <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
                  )}
                </div>
              </div>
              {/* Narrow windows: the nav becomes a select. */}
              <div className="lg:hidden">
                <Select value={active} onValueChange={jump}>
                  <SelectTrigger aria-label="Jump to group" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {searching && matches.length > 0 && (
                <p className="readout text-muted-foreground" aria-live="polite">
                  {matches.length} {matches.length === 1 ? "setting" : "settings"} in{" "}
                  {visibleGroups.length} {visibleGroups.length === 1 ? "group" : "groups"}
                </p>
              )}
            </div>
          </header>

          {searching && matches.length === 0 ? (
            <div className="border-border rounded-xl border border-dashed px-6 py-10 text-center">
              <p className="text-sm font-medium">No settings match “{query.trim()}”</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Try a shorter word, like “gpu”, “folder” or “token”.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------- groups

/** One group card. Hidden while searching when none of its rows match. */
export function SettingsGroup({ id, children }: { id: string; children: ReactNode }) {
  const { query, allowed } = useSettingsUi();
  const group = SETTINGS_GROUPS.find((g) => g.id === id);
  if (!group) throw new Error(`Unknown settings group: ${id}`);
  const any = SETTINGS.some((s) => s.group === id && allowed(s.id) && matchesQuery(s, query));
  if (!any) return null;
  return (
    <section id={`group-${id}`} aria-labelledby={`group-${id}-title`} className="scroll-mt-36">
      <div className="mb-2 px-1">
        <h2
          id={`group-${id}-title`}
          className={cn("font-display text-lg uppercase", group.danger && "text-danger")}
        >
          {group.title}
        </h2>
        <p className="text-muted-foreground text-xs">{group.description}</p>
      </div>
      <div
        className={cn(
          "bg-card divide-border divide-y overflow-hidden rounded-xl border",
          group.danger ? "border-danger/50" : "border-border",
        )}
      >
        {children}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------- rows

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-muted text-foreground rounded-sm px-0.5 underline underline-offset-2">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export interface SettingRowProps {
  id: string;
  /** The control, on the right (or below, with `stack`). */
  control?: ReactNode;
  /** Anything under the label: status lines, sub-fields, notes. */
  children?: ReactNode;
  /** Put the control under the text at full width: paths, panels. */
  stack?: boolean;
  /** Differs from its default. Shows "Changed" and, with `onReset`, a reset. */
  modified?: boolean;
  onReset?: () => void;
  /** Label for the control (`htmlFor`). */
  htmlFor?: string;
}

export function SettingRow({ id, control, children, stack, modified, onReset, htmlFor }: SettingRowProps) {
  const { query, saved, flash, allowed } = useSettingsUi();
  const meta = settingMeta(id);
  if (!allowed(id) || !matchesQuery(meta, query)) return null;
  const isSaved = saved.has(id);

  const status = (
    <span className="flex min-h-7 items-center gap-1.5">
      {isSaved && (
        <span className="readout text-ok flex items-center gap-1" role="status">
          <CheckIcon className="size-3" aria-hidden="true" />
          Saved
        </span>
      )}
      {modified && !isSaved && (
        <span className="readout text-muted-foreground" title="Differs from the default">
          Changed
        </span>
      )}
      {modified && onReset && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Reset ${meta.label} to default`}
          title="Reset to default"
          onClick={onReset}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
      )}
    </span>
  );

  return (
    <div
      data-setting-id={id}
      id={`setting-${id}`}
      className={cn(
        "scroll-mt-40 px-4 py-3 transition-colors duration-700",
        flash === id && "bg-muted ring-ring ring-2 ring-inset",
      )}
    >
      <div
        className={cn(
          "flex min-h-10 flex-col gap-3",
          !stack && "sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={htmlFor} className="text-sm font-medium">
              <Highlight text={meta.label} query={query} />
            </label>
            {stack && status}
          </div>
          <p className="text-muted-foreground text-xs">
            <Highlight text={meta.description} query={query} />
          </p>
        </div>
        {!stack && (
          <div className="flex shrink-0 items-center justify-end gap-2">
            {status}
            {control}
          </div>
        )}
        {stack && control && <div className="min-w-0">{control}</div>}
      </div>
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

/**
 * Hosts one of the self-contained settings cards (artwork, endpoints, …)
 * inside a row: drops its card frame and its own header, since the row
 * already says what it is.
 */
export function Embedded({ children }: { children: ReactNode }) {
  return (
    <div className="[&>[data-slot=card]]:gap-3 [&>[data-slot=card]]:bg-transparent [&>[data-slot=card]]:py-0 [&>[data-slot=card]]:ring-0 [&>[data-slot=card]>[data-slot=card-content]]:px-0 [&>[data-slot=card]>[data-slot=card-header]]:hidden">
      {children}
    </div>
  );
}

// ------------------------------------------------------------------- danger

/** A button that asks first. For the Reset group. */
export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
