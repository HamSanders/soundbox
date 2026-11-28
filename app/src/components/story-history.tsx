/**
 * What happened in this studio, in order.
 *
 * The panel this replaces was the Prompt box's own render log: a
 * `localStorage` array of the things *that panel* generated, in one browser.
 * Everything else a person did here — every question, every edit the
 * assistant applied, every line it wrote — left no trace, which made
 * "History" a name the panel did not earn.
 *
 * It is deliberately not the Activity page. That reads the server's rotating
 * log and answers "what is the backend doing, and why did this fail": levels,
 * sources, job ids, global and ephemeral. This answers "what did I do", per
 * studio, and survives the browser. Where they meet is `job_id` — an entry
 * that ran a job says so, and that is the thread across to the diagnostics.
 *
 * An entry can carry words, effects and results in any combination, so the
 * row renders whichever of the three it has rather than assuming a shape.
 */

import { ChevronRightIcon, Loader2Icon, WrenchIcon } from "@/lib/icons";

import { SoundCard } from "@/components/sound-card";
import { formatRelative } from "@/lib/format";
import { useHistoryEntries, useSound, useStoryConversation } from "@/lib/queries";
import type { HistoryEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One sound an entry produced, fetched by id rather than embedded: the row
 *  stores ids only, so a rename or an edit made elsewhere shows up here. */
function EntrySound({ soundId }: { soundId: string }) {
  const sound = useSound(soundId);
  if (!sound.data) return null;
  return <SoundCard sound={sound.data} dense />;
}

function EntryRow({ entry, onOpenLogs }: { entry: HistoryEntry; onOpenLogs?: () => void }) {
  const said = entry.content.trim();
  return (
    <li className="space-y-1.5">
      {entry.role === "user" ? (
        // Right-aligned like the chat it came from, so the two read the same
        // way round and a glance tells you who caused what.
        <div className="flex justify-end">
          <div className="bg-muted max-w-[85%] min-w-0 rounded-2xl rounded-tr-sm px-3 py-2">
            <p className="text-sm leading-relaxed break-words">{said}</p>
          </div>
        </div>
      ) : (
        said && <p className="text-sm leading-relaxed break-words">{said}</p>
      )}

      {entry.actions.length > 0 && (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {entry.actions.map((line, i) => (
            <li key={i} className="flex items-start gap-1.5 font-mono">
              <WrenchIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      )}

      {entry.sound_ids.length > 0 && (
        <div className="border-border/60 rounded-xl border">
          {entry.sound_ids.map((id) => (
            <EntrySound key={id} soundId={id} />
          ))}
        </div>
      )}

      <div className="text-muted-foreground/70 flex items-center gap-2 text-[11px]">
        <span>{formatRelative(entry.created_at)}</span>
        {entry.job_id && onOpenLogs && (
          // The one place history and the server log meet: this entry ran a
          // job, and the logs are where you find out how it went.
          <button
            type="button"
            className="hover:text-foreground inline-flex items-center gap-0.5 underline underline-offset-2"
            onClick={onOpenLogs}
          >
            logs
            <ChevronRightIcon className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

export function StoryHistory({
  storyId,
  className,
  onOpenLogs,
}: {
  storyId: string;
  className?: string;
  /** Called with a job id when an entry's logs are asked for. Omitted where
   *  there is nowhere to send them. */
  onOpenLogs?: (jobId: string) => void;
}) {
  const conversation = useStoryConversation(storyId);
  const entries = useHistoryEntries(conversation.data?.id ?? null);

  if (conversation.isLoading || (conversation.data && entries.isLoading)) {
    return (
      <div className={cn("text-muted-foreground flex items-center gap-2 p-3 text-sm", className)}>
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        Reading the history…
      </div>
    );
  }

  const list = entries.data ?? [];
  if (list.length === 0) {
    return (
      <p className={cn("text-muted-foreground p-3 text-sm leading-relaxed", className)}>
        Nothing yet. Ask the assistant for something, or generate from the
        Prompt panel — everything that happens in this studio is recorded
        here, in order, and stays after a reload.
      </p>
    );
  }

  return (
    <ul className={cn("space-y-4 p-2", className)}>
      {list.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          onOpenLogs={
            entry.job_id && onOpenLogs ? () => onOpenLogs(entry.job_id as string) : undefined
          }
        />
      ))}
    </ul>
  );
}

/** The count for the panel header, so it can say what it holds without the
 *  panel body having to be open. */
export function useHistoryCount(storyId: string): number {
  const conversation = useStoryConversation(storyId);
  return conversation.data?.entry_count ?? 0;
}
