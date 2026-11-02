/**
 * Where a story's device racks live: on the server, with the track.
 *
 * Each `StoryTrack` carries its insert chain, next to name, mute, solo and
 * gain. That is what lets an agent turn a knob over MCP and have the open
 * studio's rack move with it — the server announces the write on the story's
 * event stream, `useStoryEvents` refetches the tracks, and the cards redraw.
 * The chain also travels with the track row when lanes are renumbered, so a
 * removed lane no longer needs the client to shuffle racks about.
 *
 * Still true, and the rack still says it: **devices are heard on the
 * timeline, not baked into an export.** The export mixdown does not run them.
 *
 * The one thing this hook adds over a plain track mutation is pace. A dial
 * drag is sixty writes a second; sending each would be a request storm, and
 * the refetch that follows every write would land mid-drag and throw the dial
 * back to where it was a moment ago. So an edit goes into a local overlay at
 * once — the rack reads the overlay first — and the PATCH follows when the
 * lane has been still for a moment. A lane's overlay is dropped only once the
 * server holds the latest value, so nothing flickers back.
 *
 * Before 0.5 the racks were kept in this browser's localStorage. A story
 * opened with an old rack there and nothing on the server gets it moved up
 * once, then the local copy is forgotten.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, type StoryTrack } from "@/lib/api";
import type { DeviceSpec, TrackDevices } from "@/lib/devices";
import { qk, useTracks } from "@/lib/queries";

/** The 0.4 storage key. Read for the one-time move up, never written. */
const LEGACY_KEY = "soundbox.story.devices.v1";

/** How long a lane has to be still before its chain is sent. Short enough
 *  that a click has landed before you could look for it anywhere else, long
 *  enough that a sweep is one request rather than sixty. */
const SETTLE_MS = 250;

const EMPTY: TrackDevices = {};

function readLegacy(): Record<string, TrackDevices> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, TrackDevices>) : {};
  } catch {
    return {};
  }
}

/** Drop a story's racks from the 0.4 local storage — on delete, and once
 *  they have been moved to the server. */
export function forgetStoryDevices(storyId: string): void {
  try {
    const current = readLegacy();
    if (!(storyId in current)) return;
    delete current[storyId];
    if (Object.keys(current).length) localStorage.setItem(LEGACY_KEY, JSON.stringify(current));
    else localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* private mode or quota: nothing was stored there to forget */
  }
}

export interface TrackDevicesApi {
  devices: TrackDevices;
  /** Replace one lane's chain. Passing an empty array empties the rack. */
  setLane(lane: number, specs: DeviceSpec[]): void;
  /** The lane's chain as it stands right now, edits not yet sent included.
   *  For code applying several changes in a row — the studio assistant's
   *  "add an EQ, then set it" — where the render-time `devices` is a step
   *  behind by the second change. */
  getLane(lane: number): DeviceSpec[];
}

export function useTrackDevices(storyId: string): TrackDevicesApi {
  const qc = useQueryClient();
  const tracks = useTracks(storyId);

  /** Lane → the chain as edited here and not yet confirmed by the server. */
  const pending = useRef(new Map<number, DeviceSpec[]>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** Bumped by every change to `pending`, which lives in a ref. */
  const [revision, setRevision] = useState(0);

  const serverLane = useCallback(
    (lane: number): DeviceSpec[] =>
      qc
        .getQueryData<StoryTrack[]>(qk.tracks(storyId))
        ?.find((t) => t.track_index === lane)?.devices ?? [],
    [qc, storyId],
  );

  const settle = useCallback((lane: number, specs: DeviceSpec[]) => {
    // Only if nothing newer was made while this one was on its way.
    if (pending.current.get(lane) !== specs) return;
    pending.current.delete(lane);
    setRevision((r) => r + 1);
  }, []);

  // Under the story's edit key, so the live event stream holds off
  // refetching while a write is in flight — the courtesy every other studio
  // edit gets. Not optimistic: the overlay above already is.
  const save = useMutation<StoryTrack, Error, { lane: number; specs: DeviceSpec[] }>({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: ({ lane, specs }) => api.updateTrack(storyId, lane, { devices: specs }),
    onSuccess: (saved, { lane, specs }) => {
      qc.setQueryData<StoryTrack[]>(qk.tracks(storyId), (rows) => {
        const list = rows ?? [];
        return list.some((t) => t.track_index === lane)
          ? list.map((t) => (t.track_index === lane ? saved : t))
          : [...list, saved];
      });
      settle(lane, specs);
    },
    onError: (err, { lane, specs }) => {
      settle(lane, specs);
      void qc.invalidateQueries({ queryKey: qk.tracks(storyId) });
      toast.error("Could not save the device rack", { description: err.message });
    },
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;

  const send = useCallback((lane: number) => {
    timers.current.delete(lane);
    const specs = pending.current.get(lane);
    if (specs) saveRef.current({ lane, specs });
  }, []);

  const setLane = useCallback(
    (lane: number, specs: DeviceSpec[]) => {
      pending.current.set(lane, specs);
      setRevision((r) => r + 1);
      const previous = timers.current.get(lane);
      if (previous) clearTimeout(previous);
      timers.current.set(
        lane,
        setTimeout(() => send(lane), SETTLE_MS),
      );
    },
    [send],
  );

  const getLane = useCallback(
    (lane: number): DeviceSpec[] => pending.current.get(lane) ?? serverLane(lane),
    [serverLane],
  );

  // Leaving the studio mid-sweep still saves where the dial stopped. Sent
  // straight to the API: the component, and its mutation, are going away.
  useEffect(() => {
    const t = timers.current;
    const p = pending.current;
    return () => {
      for (const [lane, timer] of t) {
        clearTimeout(timer);
        const specs = p.get(lane);
        if (specs) void api.updateTrack(storyId, lane, { devices: specs }).catch(() => undefined);
      }
      t.clear();
      p.clear();
    };
  }, [storyId]);

  // The one-time move up from 0.4's localStorage.
  const migrated = useRef<string | null>(null);
  useEffect(() => {
    if (!tracks.data || migrated.current === storyId) return;
    migrated.current = storyId;
    const local = readLegacy()[storyId];
    if (!local) return;
    for (const [laneKey, specs] of Object.entries(local)) {
      const lane = Number(laneKey);
      if (!Number.isInteger(lane) || !specs?.length) continue;
      if (serverLane(lane).length === 0) setLane(lane, specs);
    }
    forgetStoryDevices(storyId);
  }, [tracks.data, storyId, serverLane, setLane]);

  const devices = useMemo(() => {
    const out: TrackDevices = {};
    for (const t of tracks.data ?? []) if (t.devices?.length) out[t.track_index] = t.devices;
    for (const [lane, specs] of pending.current) {
      if (specs.length) out[lane] = specs;
      else delete out[lane];
    }
    return Object.keys(out).length ? out : EMPTY;
    // `revision` stands in for the overlay, which is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.data, revision]);

  return { devices, setLane, getLane };
}
