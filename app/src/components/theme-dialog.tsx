/**
 * Theme, opened from the sidebar: light or dark, and the moving background
 * behind the panels. Both apply as you pick them, so the dialog is a live
 * preview with no Save button.
 *
 * The mode is next-themes' (`light` / `dark`); the background and whether it
 * reacts are per-browser `ui-prefs`, the same ones Settings → Interface edits.
 * The swatches draw from each style's own theme colours
 * (`--ambient-<style>-1..3` in index.css), so they change with the mode.
 */

import { CheckIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import type { CSSProperties, ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUiPrefs } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

type Background = ReturnType<typeof useUiPrefs.getState>["background"];

const BACKGROUNDS: { id: Background; label: string }[] = [
  { id: "smoke", label: "Smoke" },
  { id: "liquid", label: "Liquid" },
  { id: "gradient", label: "Gradient" },
  { id: "pixel", label: "Pixel" },
  { id: "none", label: "None" },
];

function swatch(id: Background): CSSProperties {
  if (id === "none") return { background: "var(--ambient-ground)" };
  const c = (n: number) => `var(--ambient-${id}-${n})`;
  if (id === "pixel") {
    return {
      backgroundColor: "var(--ambient-ground)",
      backgroundImage: `conic-gradient(${c(1)} 25%, transparent 0 50%, ${c(2)} 0 75%, transparent 0)`,
      backgroundSize: "10px 10px",
    };
  }
  if (id === "gradient") return { background: `linear-gradient(135deg, ${c(1)}, ${c(2)} 55%, ${c(3)})` };
  if (id === "liquid") {
    return {
      background: `radial-gradient(circle at 30% 35%, ${c(1)} 0 22%, transparent 45%), radial-gradient(circle at 72% 65%, ${c(2)} 0 20%, transparent 48%), ${c(3)}`,
    };
  }
  return {
    background: `radial-gradient(ellipse at 25% 70%, ${c(1)}, transparent 60%), radial-gradient(ellipse at 75% 30%, ${c(2)}, transparent 55%), var(--ambient-ground)`,
  };
}

function Tile({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-lg border p-1.5 text-left text-xs transition-colors outline-none",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        selected ? "border-primary bg-accent" : "border-border hover:bg-accent/60",
      )}
    >
      {children}
      <span className="flex items-center justify-between px-0.5 font-medium">
        {label}
        {selected && <CheckIcon className="text-primary size-3.5" aria-hidden />}
      </span>
    </button>
  );
}

export function ThemeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mode = resolvedTheme === "light" ? "light" : "dark";
  const background = useUiPrefs((s) => s.background);
  const reactive = useUiPrefs((s) => s.backgroundReactive);
  const set = useUiPrefs((s) => s.set);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
          <DialogDescription>Changes apply as you pick them.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Mode</h3>
          <div role="radiogroup" aria-label="Mode" className="grid grid-cols-2 gap-2">
            {(["light", "dark"] as const).map((m) => (
              <Tile key={m} selected={mode === m} onSelect={() => setTheme(m)} label={m === "light" ? "Light" : "Dark"}>
                <span
                  className={cn(
                    "flex h-14 items-center justify-center rounded-md border",
                    m === "light" ? "border-stone-300 bg-[#f4efe4] text-stone-700" : "border-stone-700 bg-[#1c1c1a] text-stone-200",
                  )}
                >
                  {m === "light" ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
                </span>
              </Tile>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Background</h3>
          <div role="radiogroup" aria-label="Background" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {BACKGROUNDS.map((b) => (
              <Tile key={b.id} selected={background === b.id} onSelect={() => set({ background: b.id })} label={b.label}>
                <span className="block h-12 rounded-md border" style={swatch(b.id)} aria-hidden />
              </Tile>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <Label htmlFor="theme-reactive" className={cn("text-sm", background === "none" && "opacity-50")}>
              Moves with the pointer and sound
            </Label>
            <Switch
              id="theme-reactive"
              checked={reactive}
              disabled={background === "none"}
              onCheckedChange={(on) => set({ backgroundReactive: on })}
            />
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
