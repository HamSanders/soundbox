import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  ActivityIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CpuIcon,
  FolderIcon,
  InfoIcon,
  Loader2Icon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import { create } from "zustand";

import { ProfileManagerDialog } from "@/components/profile-manager";
import { initials } from "@/components/profile-switcher";
import { ThemeDialog } from "@/components/theme-dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SITE_URL } from "@/lib/marketing-links";
import { useActivateProfile, useProfiles } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * "You": everything that is not one of the five tab-bar places, on phones and
 * tablets. Projects, Models, Agents, Activity and Settings, then Theme and
 * About, with the profile at the top like an account page. Model A in
 * docs/device-nav/DESIGN.md.
 *
 * Opened from the header's profile button on a phone and from the foot of the
 * rail on a tablet. From 840px the sidebar holds all of this, so the sheet
 * has no trigger there. It rises from the bottom, where a thumb already is.
 */

export const useYouSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

type Item = { to: string; label: string; icon: LucideIcon };

const ITEMS: Item[] = [
  { to: "/projects", label: "Projects", icon: FolderIcon },
  { to: "/models", label: "Models", icon: CpuIcon },
  { to: "/agents", label: "Agents", icon: BotIcon },
  { to: "/activity", label: "Activity", icon: ActivityIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

/** The paths the sheet's items lead to, so the rail can light "You". */
export const YOU_MATCH = /^\/(projects|models|agents|activity|settings)(\/|$)/;

const rowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg:first-child]:text-muted-foreground [&>svg]:size-5 [&>svg]:shrink-0";

export function YouSheet() {
  const { open, setOpen } = useYouSheet();
  const { pathname } = useLocation();
  const { resolvedTheme } = useTheme();
  const { data } = useProfiles();
  const activate = useActivateProfile();
  const [themeOpen, setThemeOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const profiles = data?.profiles ?? [];
  const active = profiles.find((p) => p.active);
  const close = () => setOpen(false);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-2xl px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {/* A grab handle: says this is a sheet that can be pulled down. */}
          <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto mb-2 h-1 w-10 rounded-full" />
          <SheetTitle className="sr-only">You</SheetTitle>
          <SheetDescription className="sr-only">Your profile, settings and the rest of Mirli</SheetDescription>

          {/* The profile, like an account: whose library this is. Switching
              is a whole data directory, so the list is out in the open. */}
          {active && (
            <div className="border-border mb-1 border-b px-1 pb-2">
              <div className="flex items-center gap-3 px-2 py-2">
                <span className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold uppercase">
                  {activate.isPending ? <Loader2Icon className="size-4 animate-spin" /> : initials(active.name)}
                </span>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium">{active.name}</span>
                  <span className="text-muted-foreground truncate text-xs">Profile</span>
                </span>
              </div>
              {profiles.length > 1 &&
                profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={activate.isPending}
                    className={rowClass}
                    onClick={() => !p.active && activate.mutate(p.id)}
                  >
                    <CheckIcon className={cn(!p.active && "invisible")} />
                    <span className="flex-1 truncate">{p.name}</span>
                  </button>
                ))}
              <button type="button" className={rowClass} onClick={() => setManageOpen(true)}>
                <PlusIcon />
                <span className="flex-1">New profile…</span>
              </button>
            </div>
          )}

          <nav aria-label="More">
            {ITEMS.map(({ to, label, icon: Icon }) => {
              const here = pathname === to || pathname.startsWith(`${to}/`);
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={close}
                  aria-current={here ? "page" : undefined}
                  className={cn(rowClass, here && "bg-accent font-medium")}
                >
                  <Icon />
                  <span className="flex-1">{label}</span>
                  <ChevronRightIcon className="text-muted-foreground size-4!" />
                </NavLink>
              );
            })}
          </nav>

          <div className="border-border mt-1 border-t pt-1">
            <button type="button" className={rowClass} onClick={() => setThemeOpen(true)}>
              {resolvedTheme === "light" ? <SunIcon /> : <MoonIcon />}
              <span className="flex-1">Theme</span>
            </button>
            {/* The landing page is the public site, not an app route. */}
            <a href={SITE_URL} target="_blank" rel="noreferrer noopener" className={rowClass} onClick={close}>
              <InfoIcon />
              <span className="flex-1">About Mirli</span>
            </a>
          </div>
        </SheetContent>
      </Sheet>
      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} />
      <ProfileManagerDialog open={manageOpen} onOpenChange={setManageOpen} profiles={profiles} />
    </>
  );
}

/** The phone header's button for the sheet: the profile's initials, or a
 *  person while the profile loads. Hidden from the medium size class up. */
export function YouButton() {
  const setOpen = useYouSheet((s) => s.setOpen);
  const { data } = useProfiles();
  const active = data?.profiles.find((p) => p.active);
  return (
    <button
      type="button"
      aria-label="You"
      onClick={() => setOpen(true)}
      className="bg-muted text-foreground focus-visible:ring-ring/50 relative flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase outline-none after:absolute after:-inset-1.5 focus-visible:ring-2 medium:hidden"
    >
      {active ? initials(active.name) : <UserIcon className="size-4" />}
    </button>
  );
}
