import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { CallSession, type CallHandlers, type CallState } from "./call-session";
import { CallApiError, calls, type CallMode } from "./live-client";
import { bookCallNo, nextCallNo } from "./prefs";

export interface EndedInfo { seconds: number; replies: number; last: string; reason: string }

/**
 * Starting, running and ending one call from a React screen. `begin` must be
 * called from a click: it makes the AudioContext before asking the Call API
 * for a call, because Chrome won't let audio start after an await otherwise.
 */
export function useCall(mode: CallMode, handlers: CallHandlers & { persona?: () => string | undefined; voiceId?: () => string | undefined }) {
  const live = calls;
  const qc = useQueryClient();
  const [session, setSession] = useState<CallSession | null>(null);
  const [state, setState] = useState<CallState | "off">("off");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<EndedInfo | null>(null);
  const [callNo, setCallNo] = useState(nextCallNo);
  const h = useRef(handlers);
  h.current = handlers;
  const sRef = useRef<CallSession | null>(null);

  const begin = useCallback(async (character?: string | null): Promise<boolean> => {
    setError(null);
    setEnded(null);
    setState("starting");
    let ctx: AudioContext;
    try {
      ctx = CallSession.audioContext();
    } catch (e) {
      setState("error");
      setError(String((e as Error).message ?? e));
      return false;
    }
    let grant;
    try {
      grant = await live.startCall(mode, character);
    } catch (e) {
      void ctx.close();
      setState("error");
      setError(e instanceof CallApiError ? e.message : String(e));
      return false;
    }
    const s: CallSession = new CallSession(live, grant, { persona: h.current.persona?.() ?? grant.persona, voiceId: h.current.voiceId?.() || grant.voice_id || undefined }, {
      ...h.current,
      state: (st) => { setState(st); h.current.state?.(st); },
      note: (t, err) => { if (err && !s.startedAt) setError(t); h.current.note?.(t, err); },
      ended: (reason) => {
        setEnded({ seconds: s.seconds, replies: s.replies, last: s.lastReply, reason });
        // The hang-up reaches the server just after this; refresh the history once it has.
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["calls", "history"] }), 300);
        h.current.ended?.(reason);
      },
    });
    // Forward every handler at call time, so screens can change them between renders.
    for (const k of ["partial", "final", "replyDelta", "flush", "turn", "video", "info"] as const) {
      s.on[k] = ((...a: unknown[]) => (h.current[k] as ((...x: unknown[]) => void) | undefined)?.(...a)) as never;
    }
    sRef.current = s;
    setSession(s);
    bookCallNo(callNo);
    s.start(ctx);
    return true;
  }, [live, mode, callNo, qc]);

  const hangUp = useCallback((reason?: string) => { void sRef.current?.hangUp(reason); }, []);

  /** After "call again": a fresh call number for the next one. */
  const reset = useCallback(() => { setEnded(null); setError(null); setState("off"); setSession(null); sRef.current = null; setCallNo(nextCallNo()); }, []);

  // Leaving the screen ends the call.
  useEffect(() => () => { void sRef.current?.hangUp("left"); }, []);
  // Closing the tab: tell the API (keepalive survives the unload).
  useEffect(() => {
    const bye = () => {
      const s = sRef.current;
      if (s && s.startedAt) fetch(`${live.baseUrl}/calls/${s.callId}`, { method: "DELETE", keepalive: true, headers: { "X-Soundbox": "1" } }).catch(() => {});
    };
    addEventListener("pagehide", bye);
    return () => removeEventListener("pagehide", bye);
  }, [live]);

  return { session, state, error, ended, begin, hangUp, reset, callNo };
}
