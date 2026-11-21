/**
 * Hero art for the free tools, drawn in code from the app's lane colours.
 *
 * SplitArt: one waveform whose bars come apart into a vocal half and an
 * instrumental half, and back, the tool's whole job in one loop.
 * BeatArt: rings opening on the beat behind a slowly turning Camelot wheel.
 * CamelotWheel is also the real result graphic on the BPM and key page.
 *
 * Decoration stops under prefers-reduced-motion (the `tools-anim` class, see
 * shell.tsx) and leaves a still picture.
 */

import { laneColor } from "@/lib/lanes";
import { cn } from "@/lib/utils";

export const VOCAL_LANE = 6;
export const MUSIC_LANE = 0;

/** A made-up but song-shaped envelope: phrases for the voice, a steady pulse for the band. */
function envelopes(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const phrase = Math.max(0, Math.sin(i * 0.19 + 0.6)) * (0.55 + 0.45 * Math.abs(Math.sin(i * 0.71)));
    const band = 0.45 + 0.35 * Math.abs(Math.sin(i * 0.33)) + (i % 4 === 0 ? 0.2 : 0);
    return { vocal: 0.08 + phrase * 0.92, band: Math.min(1, band) };
  });
}

export function SplitArt({ className }: { className?: string }) {
  const bars = envelopes(44);
  return (
    <div className={cn("relative flex size-full items-center justify-center", className)}>
      <style>{SPLIT_STYLES}</style>
      <div className="flex h-[62%] w-[88%] items-center justify-between">
        {bars.map((b, i) => (
          <div key={i} className="flex h-full w-[1.3%] flex-col items-center justify-center">
            <div className="tools-anim tools-split-up flex h-1/2 w-full items-end" style={{ animationDelay: `${i * 0.035}s` }}>
              <div className="w-full rounded-full" style={{ height: `${b.vocal * 100}%`, background: laneColor(VOCAL_LANE, 0.95) }} />
            </div>
            <div className="tools-anim tools-split-down flex h-1/2 w-full items-start" style={{ animationDelay: `${i * 0.035}s` }}>
              <div className="w-full rounded-full" style={{ height: `${b.band * 100}%`, background: laneColor(MUSIC_LANE, 0.95) }} />
            </div>
          </div>
        ))}
      </div>
      <span className="readout absolute top-[9%] right-[7%] flex items-center gap-1.5 rounded-sm bg-black/35 px-2 py-1 text-white/90 backdrop-blur-sm">
        <span className="size-2 rounded-full" style={{ background: laneColor(VOCAL_LANE) }} />
        Vocals
      </span>
      <span className="readout absolute right-[7%] bottom-[9%] flex items-center gap-1.5 rounded-sm bg-black/35 px-2 py-1 text-white/90 backdrop-blur-sm">
        <span className="size-2 rounded-full" style={{ background: laneColor(MUSIC_LANE) }} />
        Instrumental
      </span>
    </div>
  );
}

const SPLIT_STYLES = `
@keyframes tools-split-up { 0%, 18% { transform: translateY(1px); } 42%, 76% { transform: translateY(-14%); } 100% { transform: translateY(1px); } }
@keyframes tools-split-down { 0%, 18% { transform: translateY(-1px); } 42%, 76% { transform: translateY(14%); } 100% { transform: translateY(-1px); } }
.tools-split-up { animation: tools-split-up 7s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
.tools-split-down { animation: tools-split-down 7s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .tools-split-up { transform: translateY(-14%); }
  .tools-split-down { transform: translateY(14%); }
}
`;

export function BeatArt({ bpm = 120, className }: { bpm?: number; className?: string }) {
  const beat = 60 / bpm;
  return (
    <div className={cn("relative flex size-full items-center justify-center overflow-hidden", className)}>
      <style>{BEAT_STYLES}</style>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="tools-anim tools-ring absolute aspect-square w-[85%] max-w-[34rem] rounded-full border-2"
          style={{
            borderColor: laneColor(i % 2 ? 2 : 4, 0.7),
            animationDuration: `${beat * 4}s`,
            animationDelay: `${i * beat}s`,
          }}
        />
      ))}
      <div className="tools-anim tools-spin aspect-square w-[62%] max-w-[25rem] opacity-90">
        <CamelotWheel highlight="8B" className="size-full" />
      </div>
      <span
        className="tools-anim tools-beat absolute size-3 rounded-full bg-white"
        style={{ animationDuration: `${beat}s` }}
        aria-hidden="true"
      />
    </div>
  );
}

const BEAT_STYLES = `
@keyframes tools-ring { from { transform: scale(0.35); opacity: 0; } 25% { opacity: 1; } to { transform: scale(1.15); opacity: 0; } }
.tools-ring { animation: tools-ring 2s ease-out infinite; opacity: 0; }
@keyframes tools-spin { to { transform: rotate(360deg); } }
.tools-spin { animation: tools-spin 120s linear infinite; }
@keyframes tools-beat { 0% { transform: scale(1.6); opacity: 1; } 60%, 100% { transform: scale(1); opacity: 0.5; } }
.tools-beat { animation: tools-beat 0.5s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .tools-ring { opacity: 0.5; transform: scale(0.8); } }
`;

/* ------------------------------------------------------------- Camelot */

/**
 * Camelot code → key, spelled as Mixed In Key's own chart spells them
 * (https://mixedinkey.com/?p=7073, read 2026-11-21). Agrees with the
 * CAMELOT_MAJOR / CAMELOT_MINOR tables in analyze.ts.
 */
export const CAMELOT_KEYS: Record<string, string> = {
  "1A": "G♯ minor", "1B": "B major",
  "2A": "D♯ minor", "2B": "F♯ major",
  "3A": "B♭ minor", "3B": "D♭ major",
  "4A": "F minor", "4B": "A♭ major",
  "5A": "C minor", "5B": "E♭ major",
  "6A": "G minor", "6B": "B♭ major",
  "7A": "D minor", "7B": "F major",
  "8A": "A minor", "8B": "C major",
  "9A": "E minor", "9B": "G major",
  "10A": "B minor", "10B": "D major",
  "11A": "F♯ minor", "11B": "A major",
  "12A": "C♯ minor", "12B": "E major",
};

/** The keys that mix cleanly with `code`: one step either way on its ring, and its relative. */
export function camelotNeighbours(code: string): string[] {
  const m = /^(\d{1,2})([AB])$/.exec(code);
  if (!m) return [];
  const n = Number(m[1]);
  const l = m[2]!;
  const wrap = (x: number) => ((x - 1 + 12) % 12) + 1;
  return [`${wrap(n - 1)}${l}`, `${wrap(n + 1)}${l}`, `${n}${l === "A" ? "B" : "A"}`];
}

/** The wheel: majors (B) outside, minors (A) inside, 12 at the top, numbers rising clockwise. */
export function CamelotWheel({ highlight, className }: { highlight?: string; className?: string }) {
  const near = highlight ? new Set(camelotNeighbours(highlight)) : new Set<string>();
  const C = 120;
  const seg = (n: number, r0: number, r1: number) => {
    const a0 = ((n % 12) * 30 - 15 - 90) * (Math.PI / 180);
    const a1 = a0 + (30 * Math.PI) / 180;
    const p = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
    return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
  };
  const label = (n: number, r: number) => {
    const a = ((n % 12) * 30 - 90) * (Math.PI / 180);
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
  };
  const rings: { letter: "A" | "B"; r0: number; r1: number }[] = [
    { letter: "B", r0: 82, r1: 118 },
    { letter: "A", r0: 46, r1: 82 },
  ];
  return (
    <svg viewBox="0 0 240 240" className={className} role="img" aria-label={highlight ? `Camelot wheel, ${highlight} marked` : "Camelot wheel"}>
      {rings.map(({ letter, r0, r1 }) =>
        Array.from({ length: 12 }, (_, i) => {
          const n = i + 1;
          const code = `${n}${letter}`;
          const on = code === highlight;
          const close = near.has(code);
          const hue = (n * 30 + 20) % 360;
          const pos = label(n, (r0 + r1) / 2);
          return (
            <g key={code}>
              <title>{`${code} · ${CAMELOT_KEYS[code]}`}</title>
              <path
                d={seg(n, r0, r1)}
                fill={on ? "var(--color-foreground)" : `oklch(0.72 0.13 ${hue} / ${close ? 0.85 : highlight ? 0.22 : 0.5})`}
                stroke="var(--color-dusk)"
                strokeWidth={1.5}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="font-display"
                fontSize={letter === "B" ? 13 : 11}
                fontWeight={800}
                fill={on ? "var(--color-background)" : "rgba(255,255,255,0.92)"}
              >
                {code}
              </text>
            </g>
          );
        }),
      )}
      <circle cx={C} cy={C} r={44} fill="var(--color-dusk)" />
    </svg>
  );
}
