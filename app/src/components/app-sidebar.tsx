/**
 * Left sidebar — the app's primary navigation, in the shape of the AI-chatbot
 * pattern: a "new" action at the top, primary nav, a list of recent items you
 * can jump back into, and utility controls in the footer. Collapses to an icon
 * rail (Ctrl/Cmd+B, or the trigger in the header).
 */

import { BrandMark, Wordmark } from "@/components/brand-mark";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  ActivityIcon,
  BotIcon,
  ChevronDownIcon,
  CpuIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  LibraryIcon,
  MessagesSquareIcon,
  MicIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDeleteSession,
  useHealth,
  useModelAction,
  useModels,
  useSessions,
  useUpdateStatus,
  useCan,
} from "@/lib/queries";
import { useUiPrefs, wantsRail } from "@/lib/ui-prefs";
import { formatMb, formatRelative } from "@/lib/format";
import { SITE_URL } from "@/lib/marketing-links";
import { useSessionStore } from "@/lib/session-store";
import { api, type Model, type Session, type Sound } from "@/lib/api";
import { useDetailStore } from "@/lib/detail-store";
import { cn } from "@/lib/utils";

/**
 * `Recent` is a dynamic group, not a nav link, and reads as content you're
 * working *in* — so it sits between what you'd check before generating
 * (Library, Models) and what's app-level rather than content (Settings,
 * API & MCP, Activity). "Generate" is deliberately not here: `New sound` in
 * the header already covers that entry point and starts a clean session,
 * which a plain nav link to "/chat" would not — see its own comment below.
 */
/**
 * Studio: the places you build something, over one sitting or many. The
 * Studio entry is the shelf both builders share — there is one link rather
 * than two because you go there to find a piece of work, and which builder it
 * opens in is the piece's own answer; starting a *new* one is the "New sound"
 * button above, which is where the choice belongs.
 *
 * The Lab is beside it rather than under it because making a voice and using
 * one are different sittings: the Lab is where a voice is cloned, recorded and
 * auditioned once, and what comes out of it is an input to the Script Builder.
 * Models and Agents sit alongside them because they are also things you
 * operate rather than things you browse.
 *
 * "/studio" owns every story under it and "/voice/lab" belongs to a sibling —
 * `end: true` would go dark the moment you opened a story, so `end: false`
 * with an `except` is what lights exactly one of them.
 */
const NAV_STUDIO: NavItem[] = [
  {
    to: "/studio",
    label: "Studio",
    icon: MessagesSquareIcon,
    end: false,
    hue: "studio",
  },
  { to: "/voice/lab", label: "Voice Lab", icon: MicIcon, end: false, hue: "voice" },
  // A project is a folder over many samples, not a single kind of one — so
  // unlike Samples below it isn't category-scoped, and it isn't a browse
  // surface either (it's where you organize what Studio work produced). That
  // makes it a Studio entry, not a third group between Studio and Samples.
  { to: "/projects", label: "Projects", icon: FolderIcon, end: false, hue: "projects" },
  { to: "/models", label: "Models", icon: CpuIcon, end: false, hue: "models" },
  // MCP is a first-class surface, not a footer utility link: this is where an
  // agent connected over MCP shows up, so it lives beside the areas a human
  // works in, not tucked under Settings/Activity.
  { to: "/agents", label: "Agents", icon: BotIcon, end: false, hue: "agents" },
];

/** Samples: what you have already made, split by kind so an SFX browse never
 *  turns up a music track or a spoken read. Browsing, not doing — which is why
 *  it is a group of its own rather than more entries under Studio. */
const NAV_SAMPLES: NavItem[] = [
  // Create is the create panel beside one kind's list (Music / SFX / Speech
  // are tabs in that panel); Library is everything made, in one list.
  {
    to: "/create",
    label: "Create",
    icon: PlusIcon,
    end: false,
    hue: "sfx",
    match: /^\/(create|library\/(music|sfx|speech))(\/|$)/,
  },
  { to: "/library", label: "Library", icon: LibraryIcon, end: true, hue: "sfx" },
];

/** App-level nav — not content you're working in, so it lives in the sticky
 *  footer alongside About/theme/device rather than the scrollable content
 *  area, where it would otherwise drift out of view under a long Recent
 *  list. */
const NAV_FOOTER: NavItem[] = [
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
  { to: "/activity", label: "Activity", icon: ActivityIcon, end: false },
  // No "API & MCP" entry: the reference is published once, on the public site
  // at /docs/reference, instead of being maintained as a second in-app copy
  // that drifted. Agents (above) is the in-app MCP surface.
];

/** Groups only bother with a search box once a list is long enough that
 *  scanning it beats scrolling it — below this, a filter input is just
 *  clutter over a couple of items. */
const SEARCH_THRESHOLD = 6;

/** A session created (or freshly queued) this recently still shows in Recent
 *  even with zero sounds — see the comment on `ensure_session` in
 *  service.py: a session appears in the sidebar the moment a job is queued,
 *  before the first sound has landed. Older zero-sound sessions are treated
 *  as orphaned/empty and hidden. */
const RECENTLY_CREATED_MS = 60_000;

/** Small filter input matching the sizing/feel of the inline "New project"
 *  create field (`h-7 text-sm`). Hidden behind a search icon in the group
 *  header until clicked — Escape or the trailing "x" closes it again (and
 *  clears whatever was typed) rather than just emptying the field. */
function SidebarSearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="relative px-2 pb-1">
      <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-4.5 size-3.5 -translate-y-1/2" />
      <Input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 pr-6 pl-7 text-sm"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        onBlur={() => {
          if (!value) onClose();
        }}
      />
      <button
        type="button"
        aria-label="Close search"
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3.5 -translate-y-1/2"
        onClick={onClose}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** The library page a sound of this model category is browsed on. */
function libraryPathFor(category: Model["category"] | undefined): string {
  switch (category) {
    case "music":
      return "/library/music";
    case "sfx":
      return "/library/sfx";
    case "voice":
      return "/library/speech";
    default:
      return "/library";
  }
}

function RecentSessions() {
  const { data: sessions, isLoading } = useSessions(12);
  const activeId = useSessionStore((s) => s.sessionId);
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const deleteSession = useDeleteSession();
  const { data: models } = useModels();
  const openDetails = useDetailStore((s) => s.open);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sectionOpen, setSectionOpen] = useState(true);

  // Hide empty, non-active, stale sessions — e.g. left behind by a job that
  // errored right after creation — while still showing one that was just
  // queued (by design, per `ensure_session`/`submit_generate` in service.py,
  // a session shows up the instant a job is queued, before any sound lands).
  const nonEmpty = (sessions ?? []).filter((s) => {
    if (s.sound_count > 0) return true;
    if (s.id === activeId) return true;
    const createdMs = Date.parse(s.created_at);
    return Number.isFinite(createdMs) && Date.now() - createdMs < RECENTLY_CREATED_MS;
  });
  const items =
    search.trim().length > 0
      ? nonEmpty.filter((s) => s.title.toLowerCase().includes(search.trim().toLowerCase()))
      : nonEmpty;
  if (!isLoading && nonEmpty.length === 0) return null;

  const open = async (session: Session) => {
    // A session is a thread of generations. Its sounds live in the Library,
    // so opening one lands on the newest sound's own library page (Music,
    // SFX or Speech) with its details open, rather than replaying the thread
    // as a chat. The thread is still loaded into the session store, so the
    // entry stays highlighted and the page's composer keeps adding to it.
    const page = await api.listSounds({ session_id: session.id, limit: 500 });
    useSessionStore.getState().loadSession(session.id, page.items, session.project_id ?? null);
    setOpenMobile(false);
    const newest = page.items.reduce<Sound | null>(
      (best, s) => (!best || s.created_at > best.created_at ? s : best),
      null,
    );
    if (!newest) {
      navigate("/library");
      return;
    }
    const to = libraryPathFor(models?.find((m) => m.id === newest.model)?.category);
    navigate(to);
    openDetails(newest, to);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <Collapsible open={sectionOpen} onOpenChange={setSectionOpen}>
        <div className="flex items-center justify-between px-2">
          <CollapsibleTrigger className="focus-visible:ring-ring/50 -ml-2 flex items-center gap-1 rounded px-2 py-1 outline-none focus-visible:ring-3">
            <ChevronDownIcon
              className={cn(
                "text-muted-foreground size-3.5 transition-transform",
                !sectionOpen && "-rotate-90",
              )}
              aria-hidden="true"
            />
            <SidebarGroupLabel className="px-0">Recent</SidebarGroupLabel>
          </CollapsibleTrigger>
          {!isLoading && nonEmpty.length > SEARCH_THRESHOLD && !searchOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-5"
                  aria-label="Search recent"
                  onClick={() => setSearchOpen(true)}
                >
                  <SearchIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Search recent</TooltipContent>
            </Tooltip>
          )}
        </div>
        {searchOpen && (
          <SidebarSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search recent"
            autoFocus
            onClose={() => {
              setSearchOpen(false);
              setSearch("");
            }}
          />
        )}
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => <SidebarMenuSkeleton key={i} />)
                : items.map((s) => (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        isActive={s.id === activeId}
                        title={`${s.title}
${s.sound_count} sound${s.sound_count === 1 ? "" : "s"} · ${formatRelative(s.updated_at)}`}
                        onClick={() => void open(s)}
                      >
                        <span className="truncate">{s.title}</span>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        aria-label={`Delete session ${s.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(s);
                        }}
                      >
                        <Trash2Icon />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              {pendingDelete && (
                <>
                  &ldquo;{pendingDelete.title}&rdquo; and the{" "}
                  {pendingDelete.sound_count} sound
                  {pendingDelete.sound_count === 1 ? "" : "s"} generated in it will be
                  deleted, audio files included. This cannot be undone.
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
              disabled={deleteSession.isPending}
              onClick={() => {
                if (!pendingDelete) return;
                const id = pendingDelete.id;
                deleteSession.mutate(id, {
                  onSuccess: () => {
                    // If the thread on screen was this one, clear it rather
                    // than leaving turns whose sounds no longer exist.
                    if (useSessionStore.getState().sessionId === id) {
                      useSessionStore.getState().reset();
                    }
                    setPendingDelete(null);
                  },
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  );
}

/**
 * The rail is monochrome: places are told apart by their glyphs, not by a
 * colour per area. The map stays so an area can be given a mark again
 * without re-threading `hue` through every item; today every entry is the
 * same quiet ink. The footer utilities stay neutral too.
 */
type NavHue = "studio" | "voice" | "projects" | "models" | "agents" | "sfx" | "music";

const NAV_INK = "[&_svg]:text-foreground/80";
const HUE_CLASS: Record<NavHue, string> = {
  studio: NAV_INK,
  voice: NAV_INK,
  projects: NAV_INK,
  models: NAV_INK,
  agents: NAV_INK,
  sfx: NAV_INK,
  music: NAV_INK,
};

interface NavItem {
  to: string;
  label: string;
  icon: typeof LibraryIcon;
  end: boolean;
  /** A child path that belongs to a *different* nav item, and so must not
   *  light this one up. See "/voice" vs "/voice/lab". */
  except?: string;
  /** Area tint for the icon. Omitted for the neutral footer utilities. */
  hue?: NavHue;
  /** Lit by any path this matches, for an item that stands for several
   *  routes (Create covers the three kind pages). */
  match?: RegExp;
}

/**
 * Fold to the rail on a `wantsRail` page and unfold again on the way out,
 * restoring whatever the user had before. A choice made *on* such a page
 * (Ctrl/Cmd+B, the rail) is theirs and is left alone until the next
 * navigation. The preference turns the whole behaviour off.
 */
function useRailOnImmersivePages() {
  const { pathname } = useLocation();
  const { open, setOpen, isMobile } = useSidebar();
  const keepExpanded = useUiPrefs((s) => s.sidebarKeepExpanded);
  const rail = wantsRail(pathname);
  /** The open state to go back to once a rail page is left; null when we
   *  did not fold it ourselves. */
  const restore = useRef<boolean | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (isMobile) return;
    if (rail && !keepExpanded) {
      if (restore.current === null) {
        restore.current = openRef.current;
        if (openRef.current) setOpen(false);
      }
    } else if (restore.current !== null) {
      const back = restore.current;
      restore.current = null;
      if (back) setOpen(true);
    }
  }, [rail, keepExpanded, isMobile, setOpen]);
}

/** True when `path` falls under an item's carved-out exception, so a parent
 *  link stays dark while a sibling owns the page. */
function matchesExcept(item: NavItem, path: string): boolean {
  if (!item.except) return false;
  return path === item.except || path.startsWith(`${item.except}/`);
}

/** Shared renderer for NAV_TOP/NAV_BOTTOM — was duplicated inline for each,
 *  which is how they'd have drifted in styling the moment one changed. */
function NavGroup({
  items,
  onNavigate,
  className,
  label,
}: {
  items: NavItem[];
  onNavigate: () => void;
  className?: string;
  /** Omitted for the footer group, which sits under its own divider and needs
   *  no heading to say what it is. */
  label?: string;
}) {
  const { pathname } = useLocation();
  return (
    <SidebarGroup className={className}>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <NavLink to={item.to} end={item.end} onClick={onNavigate}>
                {({ isActive }) => (
                  <SidebarMenuButton
                    isActive={item.match ? item.match.test(pathname) : isActive && !matchesExcept(item, pathname)}
                    tooltip={item.label}
                    className={cn(
                      "transition-colors duration-(--duration-fast)",
                      item.hue
                        ? cn(HUE_CLASS[item.hue], "[&_svg]:opacity-70 [&[data-active=true]_svg]:opacity-100")
                        : "[&[data-active=true]_svg]:text-sidebar-primary",
                    )}
                    asChild
                  >
                    <span>
                      <item.icon />
                      <span>{item.label}</span>
                    </span>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * "A newer version is out", only when the daily check found one. Links to the
 * release page rather than installing anything: the desktop app has its own
 * prompt, and a Docker or source install updates its own way.
 */
function UpdateNotice() {
  const { data } = useUpdateStatus();
  if (!data?.available || !data.url) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={`Mirli ${data.latest} is available`} asChild>
        <a href={data.url} target="_blank" rel="noreferrer noopener">
          <DownloadIcon />
          <span>Update to {data.latest}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * The device row: a dot for the backend, the GPU's name, and VRAM in use.
 * Clicking it opens the one place the loaded model can be seen and unloaded
 * without a trip to Models — freeing VRAM is the thing people want from this
 * row when a generation has just failed for lack of it.
 */
function DeviceStatus() {
  const { data, isLoading, isError } = useHealth();
  const { data: models } = useModels();
  const { unload } = useModelAction();
  const { state } = useSidebar();
  const [open, setOpen] = useState(false);

  if (isLoading) return <SidebarMenuSkeleton />;

  const offline = isError || !data;
  const dot = (
    <span
      className={cn("sb-led", offline ? "text-danger" : "text-ok")}
      aria-hidden="true"
    />
  );
  const used =
    data && data.vram_total_mb && data.vram_free_mb != null
      ? data.vram_total_mb - data.vram_free_mb
      : null;
  const percent =
    used !== null && data?.vram_total_mb ? Math.round((used / data.vram_total_mb) * 100) : null;
  const loaded = data?.loaded_model
    ? (models?.find((m) => m.id === data.loaded_model) ?? null)
    : null;
  const loadedName = loaded?.name ?? data?.loaded_model ?? null;
  const title = offline ? "Backend offline" : (data.gpu_name ?? data.device);
  const subtitle = offline
    ? "Start the server"
    : used !== null
      ? `${formatMb(used)} / ${formatMb(data.vram_total_mb)} VRAM`
      : data.device;

  // No `tooltip` prop on the button: SidebarMenuButton would then wrap
  // itself in a Tooltip, and PopoverTrigger's Slot would clone that wrapper
  // (which renders no element) instead of the button, so a click would
  // open nothing. The tooltip is composed on the outside instead, for the
  // rail, where the row's text is hidden.
  const row = (
    <PopoverTrigger asChild>
      <SidebarMenuButton
        size="lg"
        aria-label={`Device: ${title}, ${subtitle}. Show details.`}
        aria-expanded={open}
        className="group-data-[collapsible=icon]:justify-center"
      >
        {dot}
        {/* Hidden on the icon rail — otherwise the labels clip to a letter. */}
        <div className="grid min-w-0 flex-1 text-left text-xs leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium">{title}</span>
          <span className="text-muted-foreground readout truncate">{subtitle}</span>
        </div>
      </SidebarMenuButton>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {open ? (
        row
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent side="right" hidden={state !== "collapsed"}>
            {title} · {subtitle}
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent side="right" align="end" className="w-72 p-3">
        {offline ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">Backend offline</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              The app cannot reach the Mirli server. Start it (or the desktop app) and this
              row turns green on its own; nothing in the library is affected.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{data.gpu_name ?? data.device}</p>
              <p className="text-muted-foreground text-xs">
                {data.gpu_name ? `Running on ${data.device}` : "No discrete GPU reported"}
                {" · "}Mirli {data.version}
              </p>
            </div>
            {used !== null && data.vram_total_mb ? (
              <div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">VRAM in use</span>
                  <span className="readout tabular-nums">
                    {formatMb(used)} / {formatMb(data.vram_total_mb)}
                  </span>
                </div>
                <Progress value={percent ?? 0} className="mt-1.5 h-1.5" aria-label="VRAM in use" />
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatMb(data.vram_free_mb)} free
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                No VRAM readout on this device.
              </p>
            )}
            <div className="border-border/60 border-t pt-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">Loaded model</p>
                  <p className="truncate text-sm">{loadedName ?? "None"}</p>
                </div>
                {data.loaded_model && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-xs"
                    disabled={unload.isPending || data.queue_length > 0}
                    onClick={() => unload.mutate(data.loaded_model as string)}
                  >
                    {unload.isPending ? "Unloading…" : "Unload (frees VRAM)"}
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                {data.queue_length > 0
                  ? `${data.queue_length} job${data.queue_length === 1 ? "" : "s"} running: the model stays loaded until they finish.`
                  : data.loaded_model
                    ? "The next generation loads it again, which takes a few seconds."
                    : "The first generation loads whichever model it needs."}
              </p>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}


function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  return (
    <SidebarMenuButton
      tooltip={isDark ? "Light theme" : "Dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="[&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:rotate-45"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      <span>{isDark ? "Light theme" : "Dark theme"}</span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const can = useCan();
  useRailOnImmersivePages();

  return (
    <>
      {/* pr-2.5: panels sit 8px apart, the same as their margin from the
          window edges. */}
      <Sidebar collapsible="icon" variant="inset" className="pr-2.5">
        {/* The logo, top left, on the same line as the header bar beside it. */}
        <SidebarHeader className="h-14 justify-center">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip="Mirli home">
                <NavLink to="/" end onClick={() => setOpenMobile(false)}>
                  <span className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-sm">
                    <BrandMark inset={0.04} className="size-6" />
                  </span>
                  <Wordmark className="truncate text-lg leading-none font-extrabold" />
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {/* Create and Library first: making a sound and finding one are
              the two things you open the app to do. */}
          <NavGroup items={NAV_SAMPLES} onNavigate={() => setOpenMobile(false)} className="mt-3" />
          <NavGroup label="Studio" items={NAV_STUDIO} onNavigate={() => setOpenMobile(false)} />

          <RecentSessions />

          {/* Still page navigation (it gets the active-route highlight
              Recent entries don't), just app-level rather than content
              you're working in. */}
          <NavGroup items={NAV_FOOTER} onNavigate={() => setOpenMobile(false)} className="mt-auto" />
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            {/* The landing page is part of the public site now, not the app,
                so this leaves the app rather than routing inside it — the
                app has no /welcome route any more. */}
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="About Mirli" asChild>
                <a href={SITE_URL} target="_blank" rel="noreferrer noopener">
                  <InfoIcon />
                  <span>About Mirli</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {can.updates && <UpdateNotice />}
            <SidebarMenuItem>
              <ThemeToggle />
            </SidebarMenuItem>
            {can.gpu_status && (
              <SidebarMenuItem>
                <DeviceStatus />
              </SidebarMenuItem>
            )}
            {/* The profile, last, like an account: whose library this is. */}
            <SidebarMenuItem>
              <ProfileSwitcher />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
