/**
 * Play one clip at a time for the voice slots: a library sound (a take) or
 * the result of a speak job (a voice preview, a term in context). Claims the
 * app-wide player store, so the editor's own player pauses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api, type Job } from "@/lib/api";
import { usePlayerStore } from "@/lib/player-store";

const OWNER = "audiobook-voice";

export interface ClipPlayer {
  /** Key of what is playing or loading, or null. */
  active: string | null;
  loading: boolean;
  playSound: (key: string, soundId: string) => void;
  playJob: (key: string, job: Job | Promise<{ job: Job }>) => void;
  stop: () => void;
}

export function useClipPlayer(): ClipPlayer {
  const audio = useRef<HTMLAudioElement | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const claim = usePlayerStore((s) => s.play);
  const release = usePlayerStore((s) => s.stop);
  const owner = usePlayerStore((s) => s.playingId);

  const stop = useCallback(() => {
    audio.current?.pause();
    unsub.current?.();
    unsub.current = null;
    setActive(null);
    setLoading(false);
    release(OWNER);
  }, [release]);

  // Another player took over: go quiet. Reads as stopped from the moment the
  // store changes hands, without a second render.
  const ours = owner === OWNER || loading;
  useEffect(() => {
    if (owner !== OWNER && !loading) audio.current?.pause();
  }, [owner, loading]);
  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (key: string, soundId: string) => {
      try {
        const sound = await api.getSound(soundId);
        if (!audio.current) audio.current = new Audio();
        const el = audio.current;
        el.src = sound.file;
        el.onended = () => stop();
        claim(OWNER);
        setLoading(false);
        setActive(key);
        await el.play();
      } catch (e) {
        stop();
        toast.error((e as Error).message || "Could not play this clip");
      }
    },
    [claim, stop],
  );

  const playSound = useCallback(
    (key: string, soundId: string) => {
      if (ours && active === key) return stop();
      stop();
      setActive(key);
      setLoading(true);
      void start(key, soundId);
    },
    [active, ours, start, stop],
  );

  const playJob = useCallback(
    (key: string, job: Job | Promise<{ job: Job }>) => {
      if (ours && active === key) return stop();
      stop();
      setActive(key);
      setLoading(true);
      void Promise.resolve(job)
        .then((j) => ("job" in j ? j.job : j))
        .then((j) => {
          const finish = (done: Job) => {
            const id = done.result?.sounds?.[0];
            if (done.status === "done" && id) void start(key, id);
            else {
              stop();
              if (done.status === "error") toast.error(done.error || "The read failed");
            }
          };
          if (j.status === "done" || j.status === "error" || j.status === "cancelled") return finish(j);
          unsub.current = api.subscribeJob(j.id, (u) => {
            if (u.status === "done" || u.status === "error" || u.status === "cancelled") finish(u);
          });
        })
        .catch((e: unknown) => {
          stop();
          toast.error((e as Error).message || "Could not start the read");
        });
    },
    [active, ours, start, stop],
  );

  return { active: ours ? active : null, loading, playSound, playJob, stop };
}
