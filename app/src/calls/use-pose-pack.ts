import { useEffect, useRef, useState } from "react";

import type { CallSession } from "./call-session";
import { calls, type Character } from "./live-client";
import { createPosePlayer, FaceCompositor, loadImage, tagStream, WORD_CUES, type PackManifest, type PosePlayer } from "./pose-player";

/**
 * A character's avatar pack in a video call: loads the manifest, plays the
 * pose clips in two stacked <video>s, and pastes the live face into the talk
 * still while the character is on the talk pose and the face is streaming.
 *
 * Returns refs for the two videos and the composite canvas, whether the live
 * face is showing, and hooks the call screen calls on state and reply text.
 */
export function usePosePack(character: Character | undefined, session: CallSession | null) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [still, setStill] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const player = useRef<PosePlayer | null>(null);
  const comp = useRef<FaceCompositor | null>(null);
  const tags = useRef(tagStream());
  const cued = useRef(new Set<string>());
  const reply = useRef("");
  const packUrl = character?.pack_url ? calls.url(character.pack_url) : null;

  // Load the manifest and the talk still.
  useEffect(() => {
    setManifest(null);
    setStill(null);
    comp.current = null;
    if (!packUrl) return;
    let gone = false;
    (async () => {
      const m = (await (await fetch(packUrl)).json()) as PackManifest;
      if (gone || !m.clips?.length) return;
      const talk = m.poses[m.talkPose ?? "talk"];
      if (talk?.still && talk.faceBox) {
        const src = new URL(talk.still, packUrl).href;
        const img = await loadImage(src);
        if (gone) return;
        comp.current = new FaceCompositor(img, talk.faceBox);
        setStill(src);
      }
      setManifest(m);
    })().catch(() => { /* no pack: the plain face */ });
    return () => { gone = true; };
  }, [packUrl]);

  // A player per call: starts when the call connects.
  useEffect(() => {
    if (!manifest || !packUrl || !session || !a.current || !b.current) return;
    const p = createPosePlayer({
      manifest, base: packUrl, a: a.current, b: b.current,
      liveReady: () => session.videoOn && performance.now() - session.lastFrameAt < 1500,
      onLive: setLive,
    });
    player.current = p;
    const c = canvas.current, fc = comp.current;
    if (c && fc) {
      fc.paintStill(c);
      session.setFrameSink((bm) => fc.draw(c, bm));
    }
    return () => { p.dispose(); player.current = null; session.setFrameSink(null); setLive(false); };
  }, [manifest, packUrl, session]);

  return {
    active: !!manifest,
    manifest,
    still,
    live,
    refs: { a, b, canvas },
    start: () => player.current?.start(),
    stop: () => player.current?.stop(),
    onState: (s: string) => {
      if (s === "listening") { reply.current = ""; cued.current = new Set(); tags.current = tagStream(); }
      player.current?.setState(s);
    },
    /** Strips [tag] cues from a reply delta and acts on them, and on words like "ho ho ho". Returns the text to show. */
    onDelta: (delta: string) => {
      const r = tags.current(delta);
      r.tags.forEach((t) => player.current?.react(t));
      reply.current += r.text;
      for (const [tag, re] of WORD_CUES) {
        if (!cued.current.has(tag) && re.test(reply.current)) { cued.current.add(tag); player.current?.react(tag); }
      }
      return r.text;
    },
  };
}
