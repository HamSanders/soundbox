import { useEffect, useRef } from "react";

import type { CallSession } from "../call-session";

const buf = new Uint8Array(1024);
function peak(an: AnalyserNode | null, div: number) {
  if (!an) return 0;
  an.getByteTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i] - 128));
  return Math.min(1, p / div);
}

/**
 * The pen line: one hand-drawn stroke that swells with Mirli's voice from the
 * middle and, when `withCaller`, ripples with the caller's from the edges.
 * A canvas, redrawn every frame from the session's analysers.
 */
export function PenLine({ session, withCaller = false, className, dot = true }: {
  session: CallSession | null; withCaller?: boolean; className?: string; dot?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d")!;
    const lvl = { bot: 0, you: 0 }, phase = { a: 0, b: 0 };
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const css = getComputedStyle(cv);
      const ink = css.color, beak = css.getPropertyValue("--signal").trim() || "#f2a40c";
      lvl.bot += (peak(session?.analyser ?? null, 64) - lvl.bot) * 0.22;
      lvl.you += ((withCaller && session && !session.muted ? peak(session.micAnalyser, 64) : 0) - lvl.you) * 0.18;
      phase.a += 0.035 + lvl.bot * 0.09;
      phase.b += 0.05 + lvl.you * 0.08;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const mid = H * 0.5, amp = H * 0.42, x0 = 8, x1 = W - 14;
      g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = ink; g.globalAlpha = 0.9;
      g.beginPath();
      let lastY = mid;
      for (let x = x0; x <= x1; x += 4) {
        const t = (x - x0) / (x1 - x0);
        const env = Math.sin(t * Math.PI) ** 1.4;
        const edge = (Math.cos(t * Math.PI * 2) + 1) / 2;
        const y = mid + 2.2 * Math.sin(t * 9 + phase.a * 0.4)
          + env * lvl.bot * amp * Math.sin(t * 22 + phase.a) * (0.7 + 0.3 * Math.sin(t * 5 - phase.a * 0.5))
          + edge * lvl.you * amp * 0.45 * Math.sin(t * 34 - phase.b);
        if (x === x0) g.moveTo(x, y); else g.lineTo(x, y);
        lastY = y;
      }
      g.stroke();
      if (dot) {
        g.globalAlpha = Math.min(1, lvl.bot * 4);
        g.fillStyle = beak;
        g.beginPath(); g.arc(x1, lastY, 6, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [session, withCaller, dot]);
  return <canvas ref={ref} className={className} aria-hidden />;
}
