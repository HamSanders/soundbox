/**
 * Watch one story change under you.
 *
 * A story is not single-player: an agent can be writing lines over MCP while
 * the studio is open on the same timeline. Without this the page silently
 * drifts out of date and you end up editing a script that no longer matches
 * what you are looking at.
 *
 * Two things arrive. `changed` means refetch — the queries are invalidated and
 * react-query does the rest, so the script and timeline update in place rather
 * than the page reloading. `agent` means a tool is mid-work, which the studio
 * uses to say so and to stop taking edits that would race it.
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { IS_MOCK } from "@/lib/api";
import { qk } from "@/lib/queries";
import { answerStudioRequest, type StudioRequest } from "@/lib/studio-bridge";

export interface AgentActivity {
  active: boolean;
  /** What the agent is doing, in words — "reading the script". */
  label: string | null;
  count: number;
}

type StoryEvent =
  | { type: "changed" }
  | { type: "agent"; active: boolean; label: string; count: number }
  | ({ type: "request" } & StudioRequest);

const IDLE: AgentActivity = { active: false, label: null, count: 0 };

/**
 * `answer` marks this as a mounted studio that agents may ask things of: the
 * server only sends `request` events to a stream that opted in, and only to
 * one of them, because applying edits twice is not harmless.
 */
export function useStoryEvents(
  storyId: string | null,
  options: { answer?: boolean } = {},
): AgentActivity {
  const answer = options.answer ?? false;
  const qc = useQueryClient();
  const [agent, setAgent] = useState<AgentActivity>(IDLE);

  useEffect(() => {
    // The in-memory mock has no event stream to open; trying anyway is a
    // 404 the browser retries forever.
    if (!storyId || IS_MOCK) return;
    setAgent(IDLE);

    const source = new EventSource(
      `/api/stories/${encodeURIComponent(storyId)}/events${answer ? "?answer=1" : ""}`,
    );

    source.onmessage = (message) => {
      let event: StoryEvent;
      try {
        event = JSON.parse(message.data) as StoryEvent;
      } catch {
        return; // a malformed frame is not worth tearing the stream down for
      }
      if (event.type === "request") {
        void answerStudioRequest(storyId, event);
        return;
      }
      if (event.type === "agent") {
        setAgent({
          active: event.active,
          label: event.active ? event.label : null,
          count: event.count,
        });
        return;
      }
      // The server announces every write, ours included. While one of ours
      // is still in flight, the refetch it will do when it settles covers
      // this too — and refetching now would land mid-drag and overwrite the
      // optimistic positions of the writes still on their way.
      if (qc.isMutating({ mutationKey: qk.storyEdits(storyId) }) > 0) return;
      // Invalidate rather than patch: the event says *that* something moved,
      // not what, and refetching is cheaper than teaching this hook the shape
      // of every mutation. One prefix covers the story, its clips and its
      // tracks; a refetch already under way is left to finish.
      void qc.invalidateQueries({ queryKey: qk.story(storyId) }, { cancelRefetch: false });
    };

    // EventSource reconnects on its own. While it was down, changes went
    // unannounced, so catch up once it is back; and don't leave the studio
    // believing an agent is still working when the connection dropped.
    let dropped = false;
    source.onopen = () => {
      if (!dropped) return;
      dropped = false;
      void qc.invalidateQueries({ queryKey: qk.story(storyId) }, { cancelRefetch: false });
    };
    source.onerror = () => {
      dropped = true;
      setAgent(IDLE);
    };

    return () => source.close();
  }, [storyId, qc, answer]);

  return agent;
}
