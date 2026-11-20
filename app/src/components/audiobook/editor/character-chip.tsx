/** The voice a paragraph is read with, as a coloured chip that recasts it. */

import { CheckIcon, ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Character } from "@/lib/audiobook-types";
import { cn } from "@/lib/utils";

import { NARRATOR_COLOR, castColor } from "./cast-colors";

export function CastDot({ color, className }: { color: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: castColor(color) }}
    />
  );
}

export function CharacterMenuItems({
  characters,
  value,
  onSelect,
}: {
  characters: Character[];
  value: string | null | undefined;
  onSelect: (characterId: string | null) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Read by</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => onSelect(null)}>
        <CastDot color={NARRATOR_COLOR} />
        <span className="flex-1">Narrator</span>
        {value === null && <CheckIcon />}
      </DropdownMenuItem>
      {characters.length > 0 && <DropdownMenuSeparator />}
      {characters.map((c) => (
        <DropdownMenuItem key={c.id} onSelect={() => onSelect(c.id)}>
          <CastDot color={c.color} />
          <span className="flex-1 truncate">{c.name}</span>
          {value === c.id && <CheckIcon />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function CharacterChip({
  character,
  characters,
  onChange,
  disabled = false,
}: {
  character: Character | null;
  characters: Character[];
  onChange: (characterId: string | null) => void;
  disabled?: boolean;
}) {
  const color = character?.color ?? NARRATOR_COLOR;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="border-border/70 hover:border-border-strong/60 focus-visible:ring-ring/50 inline-flex max-w-36 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-2"
          style={{ background: castColor(color, 0.14) }}
          aria-label={`Read by ${character?.name ?? "Narrator"}. Change`}
        >
          <CastDot color={color} />
          <span className="truncate">{character?.name ?? "Narrator"}</span>
          <ChevronDownIcon className="text-muted-foreground size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
        <CharacterMenuItems
          characters={characters}
          value={character?.id ?? null}
          onSelect={onChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
