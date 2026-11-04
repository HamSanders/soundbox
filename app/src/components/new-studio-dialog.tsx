/**
 * The door into a new piece of work — and the one place that asks which tool
 * it belongs in.
 *
 * Konchi has two builders now, not one studio that guesses. They share the
 * timeline, the library and the chat; what differs is what you start from. In
 * the Script Builder you start from words: a script beside the timeline, a
 * cast, lines you voice and re-voice. In the Music Builder you start from a
 * prompt: a request form, takes, and clips you push around. A story used to
 * work out which of those it was by inspecting its own clips — which cannot
 * be done at all on an empty one, and that is precisely the moment you need
 * the answer.
 *
 * So the question is asked once, up front, at every entry point: the sidebar,
 * the dashboard, the shelf, the command palette. Two cards, one click each.
 * The answer is stored on the story (`Story.builder`), which is what decides
 * the URL it opens at and the panels it opens with.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AudioLinesIcon, MessagesSquareIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateStory } from "@/lib/queries";
import { DEFAULT_THREAD, useAssistantStore } from "@/lib/assistant-store";
import { usePrefillStore } from "@/lib/generate-store";
import { useSessionStore } from "@/lib/session-store";
import { studioPath, type StoryBuilder } from "@/lib/api";

const CHOICES: {
  builder: StoryBuilder;
  icon: typeof MessagesSquareIcon;
  label: string;
  hint: string;
}[] = [
  {
    builder: "script",
    icon: MessagesSquareIcon,
    label: "Voice & dialogue",
    hint: "Write a script, cast it, arrange the read on a timeline.",
  },
  {
    builder: "music",
    icon: AudioLinesIcon,
    label: "Music & SFX",
    hint: "Describe a track or an effect, then arrange the takes.",
  },
];

/**
 * Start a new piece of work in a named builder.
 *
 * Not a `<Link>`, and it cannot be one: the story has to exist before there
 * is a URL to go to. `fresh` clears the thread and the composer as well —
 * starting something new should not inherit the last conversation, but
 * arriving with a prefill (Library → "Reuse") deliberately keeps it.
 */
export function useNewStudio() {
  const navigate = useNavigate();
  const createStory = useCreateStory();
  const open = (builder: StoryBuilder, fresh = true): void => {
    if (fresh) {
      usePrefillStore.getState().setPrefill(null);
      useSessionStore.getState().reset();
      // The Chat page's thread only: a new story gets a thread of its own
      // keyed to it (see `lib/assistant-store`), so there is nothing of the
      // last studio's conversation to inherit in the first place.
      useAssistantStore.getState().reset(DEFAULT_THREAD);
    }
    createStory.mutate(
      { builder },
      { onSuccess: (story) => navigate(studioPath(story)) },
    );
  };
  return { open, pending: createStory.isPending };
}

/**
 * The picker itself. Controlled by whoever opens it, because the thing that
 * opens it — a sidebar button, a dashboard card, an empty state — is also the
 * thing that knows whether the new story should start from a clean thread.
 */
export function NewStudioDialog({
  open,
  onOpenChange,
  fresh = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether to clear the current conversation and composer first. */
  fresh?: boolean;
}) {
  const studio = useNewStudio();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What are you making?</DialogTitle>
          <DialogDescription>
            The two builders share a timeline, a library and the chat — this
            picks what you start from.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHOICES.map(({ builder, icon: Icon, label, hint }) => (
            <button
              key={builder}
              type="button"
              disabled={studio.pending}
              className="border-border hover:border-primary/50 hover:bg-accent/40 flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors disabled:opacity-60"
              onClick={() => {
                onOpenChange(false);
                studio.open(builder, fresh);
              }}
            >
              <Icon className="text-muted-foreground size-5" aria-hidden="true" />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-muted-foreground text-xs leading-relaxed">{hint}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The picker plus its own open/closed state, for the common case where the
 *  caller only wants a button that opens it. Returns the dialog to render and
 *  the opener to hang off whatever button it has. */
export function useNewStudioPicker(fresh = true) {
  const [open, setOpen] = useState(false);
  return {
    open: () => setOpen(true),
    dialog: <NewStudioDialog open={open} onOpenChange={setOpen} fresh={fresh} />,
  };
}
