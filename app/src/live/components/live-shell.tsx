import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useHealth } from "../live-context";

/** Whether the call service answers, said plainly. */
export function ServiceStatus({ className }: { className?: string }) {
  const { data, isLoading, isError } = useHealth();
  const up = !!data?.ok;
  const where = data?.mode === "cloud" ? "Mirli Cloud" : "this machine";
  const text = isLoading ? "checking…" : isError ? "call service not reachable" : up ? `running on ${where}` : "voice server down";
  return (
    <span className={cn("inline-flex items-center gap-2 font-log text-xs text-muted-foreground", className)} data-testid="service-status">
      <span className={cn("size-2 rounded-full", isLoading ? "bg-muted-foreground/40" : up ? "bg-ok" : "bg-danger")} />
      {text}
    </span>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <Button variant="ghost" size="icon" aria-label={dark ? "Day theme" : "Dusk theme"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

const nav = [
  { to: "/characters", label: "Characters" },
  { to: "/voice", label: "Voice call" },
  { to: "/account", label: "Minutes" },
];

/** Header for the non-call screens. Calls take the whole window. */
export function LiveShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2" aria-label="Mirli Live home">
            <BrandMark className="size-6" />
            <span className="font-display text-xl font-extrabold uppercase tracking-wide">Mirli</span>
            <span className="font-log text-xs text-muted-foreground">live</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn("rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground", isActive && "bg-accent text-foreground")
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <ServiceStatus className="hidden md:inline-flex" />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={cn("mx-auto w-full px-4 py-10", wide ? "max-w-6xl" : "max-w-5xl")}>{children}</main>
    </div>
  );
}

/** Small typed label, the Mirli field-notebook voice. */
export function LogLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-log text-xs text-muted-foreground", className)}>{children}</span>;
}
