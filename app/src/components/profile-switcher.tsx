/**
 * The profile chip in the header: which library is open, and how to change it.
 *
 * A profile is a whole data directory — its own sounds, stories, voices and
 * settings — so switching is closer to opening a different document than to
 * flipping a setting. The chip is in the header rather than buried in Settings
 * for that reason: it is state you want to be able to see before you generate
 * into the wrong library, not a preference you set once.
 *
 * Creating and switching are deliberately separate. "New profile" makes an
 * empty one and leaves you where you are; you switch to it when you mean to.
 */

import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { ProfileManagerDialog } from "@/components/profile-manager";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActivateProfile, useProfiles } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function ProfileSwitcher() {
  const { data } = useProfiles();
  const activate = useActivateProfile();
  const [manageOpen, setManageOpen] = useState(false);

  const profiles = data?.profiles ?? [];
  const active = profiles.find((p) => p.active);
  // Before the first fetch lands there is nothing honest to name, and a chip
  // that flickers from a guess to the real name is worse than one that arrives.
  if (!active) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" tooltip={`Profile: ${active.name}`} aria-label={`Profile: ${active.name}`}>
            {/* An avatar: the profile's initials on a tile, like an account. */}
            <span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold uppercase">
              {activate.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                initials(active.name)
              )}
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{active.name}</span>
              <span className="text-muted-foreground truncate text-xs">Profile</span>
            </span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Library
          </DropdownMenuLabel>
          {profiles.map((profile) => (
            <DropdownMenuItem
              key={profile.id}
              disabled={activate.isPending}
              onSelect={() => {
                if (!profile.active) activate.mutate(profile.id);
              }}
            >
              <Check className={cn("size-4", !profile.active && "invisible")} />
              <span className="truncate">{profile.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>
            <Plus className="size-4" />
            New profile…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileManagerDialog open={manageOpen} onOpenChange={setManageOpen} profiles={profiles} />
    </>
  );
}

/** "Unreal NF" → "UN": up to two initials for the avatar tile. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)) || "?";
}
