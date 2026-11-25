/**
 * A voice's ··· menu, the same in its Voice Lab row and its docked panel.
 *
 * The items that open part of the voice (Rename, Model, Clips, History) open
 * its panel at that part. They wait for the menu to close first: Radix hands
 * focus back to the menu's trigger as it closes, which would take it straight
 * off a name field or a section that had just been focused.
 */

import { useRef } from "react";
import {
  AudioLinesIcon,
  DownloadIcon,
  HistoryIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Voice } from "@/lib/api";
import { useDock, type DockIntent } from "@/lib/dock";
import { useDeleteVoice, useExportVoice, useImageStatus, useVoiceArtwork } from "@/lib/queries";

export function VoiceMenu({ voice, inPanel = false }: { voice: Voice; inPanel?: boolean }) {
  const open = useDock((s) => s.open);
  const remove = useDeleteVoice();
  const exporter = useExportVoice();
  const drawing = useVoiceArtwork();
  // `ready` already folds in mode, engine and model: the menu asks one
  // question rather than re-deriving the rule the server settled.
  const imageReady = useImageStatus().data?.ready ?? false;
  /** The part of the panel to open once the menu has let go of focus. */
  const after = useRef<DockIntent | null>(null);
  const clone = voice.kind === "clone";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${voice.name}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(e) => {
          const intent = after.current;
          if (!intent) return;
          after.current = null;
          e.preventDefault();
          open({ kind: "voice", id: voice.id }, { intent });
        }}
      >
        {!inPanel && (
          <DropdownMenuItem onSelect={() => open({ kind: "voice", id: voice.id })}>
            <MicIcon />
            Try it
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => (after.current = "rename")}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        {clone && (
          <DropdownMenuItem onSelect={() => (after.current = "model")}>
            <Settings2Icon />
            Model
          </DropdownMenuItem>
        )}
        {clone && (
          <DropdownMenuItem onSelect={() => (after.current = "clips")}>
            <AudioLinesIcon />
            Clips
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => (after.current = "history")}>
          <HistoryIcon />
          History{voice.read_count ? ` (${voice.read_count})` : ""}
        </DropdownMenuItem>
        {/* Only offered when artwork is configured: a button that always
            fails is worse than none. The avatar is drawn from the notes. */}
        {imageReady && (
          <DropdownMenuItem disabled={drawing.isPending} onSelect={() => drawing.mutate(voice.id)}>
            {drawing.isPending && drawing.variables === voice.id ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <ImageIcon />
            )}
            {voice.artwork ? "Redraw avatar" : "Draw avatar"}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => exporter.mutate(voice)}>
          <DownloadIcon />
          Export voice file
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            remove(voice, {
              description:
                clone
                  ? "Its reference clip goes too. Sounds already read in it stay."
                  : "The model keeps the built-in voice itself.",
            })
          }
        >
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
