/**
 * A sound's details as an artifact panel, docked to the right of the page.
 *
 * Like the Studio's artifact panels (or an artifact pane beside a chat), it
 * is a third panel of the shell rather than an overlay: it sits in the same
 * row as the sidebar and the page, with the same margins and 4px gutter,
 * and the page narrows to make room. The list stays live beside it, so
 * another row swaps what it shows and the player keeps working.
 *
 * The body is `SoundArtifact`, the panel the Studio shows beside its
 * timeline: waveform editor, stems and generation details. On a narrow
 * window there is no room beside the page, so it covers it instead.
 */

import { usePanelWidth } from "@/hooks/use-panel-width";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { XIcon } from "lucide-react";

import { SoundArtifact } from "@/components/sound-artifact";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";
import { useDetailStore } from "@/lib/detail-store";

export function SoundDetailPanel() {
  const panel = usePanelWidth({ id: "sound-detail", initial: 416, min: 320, max: 720, edge: "left" });
  const sound = useDetailStore((s) => s.sound);
  const close = useDetailStore((s) => s.close);

  // The panel belongs to the page that opened it: leaving that page closes
  // it, so a sound's details never sit beside a page that has nothing to do
  // with it. Query-string changes (filters) keep it open. An opener that
  // navigates first (the sidebar's Recent list) names the page it is opening
  // the panel for; everyone else gets the page that is showing.
  //
  // "Leaving" means the route moving *off* that page, not merely differing
  // from it: the router commits a navigation in a transition, so a panel
  // opened for the destination can render a beat before the route arrives.
  const { pathname } = useLocation();
  const path = useDetailStore((s) => s.path);
  const prevPathname = useRef(pathname);
  useEffect(() => {
    const prev = prevPathname.current;
    prevPathname.current = pathname;
    if (!sound) return;
    if (path === null) useDetailStore.setState({ path: pathname });
    else if (prev === path && pathname !== path) close();
  }, [sound, path, pathname, close]);

  useEffect(() => {
    if (!sound) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sound, close]);

  if (!sound) return null;

  return (
    <aside
      aria-label={`Details for ${sound.name}`}
      className="bg-background ring-border animate-in fade-in-0 slide-in-from-right-8 fixed right-0 left-(--rail-w,0px) top-(--top-h,0px) bottom-[calc(var(--dock-h,0px)+var(--tabbar-h,0px))] z-30 flex flex-col duration-(--duration-base) expanded:static expanded:z-auto expanded:my-2 expanded:mr-2 expanded:relative expanded:h-(--panel-h) expanded:w-(--panel-w) expanded:shrink-0 expanded:rounded-xl expanded:ring-1"
      style={panel.style}
    >
      {panel.handle}
      <div className="border-border flex items-start gap-2 border-b px-4 pt-4 pb-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="font-display truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase">
            {sound.name}
          </h2>
          <p className="readout text-muted-foreground truncate">
            {sound.seed != null ? `No. ${sound.seed} · ` : ""}
            {formatDuration(sound.duration_s)} · {formatBytes(sound.size_bytes)} ·{" "}
            {formatRelative(sound.created_at)}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SoundArtifact key={sound.id} sound={sound} />
      </div>
    </aside>
  );
}
