import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { TurnStats } from "../call-session";
import { pad } from "../prefs";
import { useCallVoices } from "../queries";

/** Small typed label, the Mirli field-notebook voice. */
export function LogLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-log text-xs text-muted-foreground", className)}>{children}</span>;
}

export const STATE_WORDS: Record<string, string> = {
  off: "ready to call", starting: "connecting", idle: "your turn", listening: "listening", thinking: "thinking",
  speaking: "speaking", error: "error", closed: "call ended",
};

export interface LogEntry { id: number; kind: "you" | "bot" | "sys"; text: string; at: number; live?: boolean; err?: boolean; no?: number }

/** The call log as a small state machine: partial → final for you, deltas for the reply. */
export function useCallLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const seq = useRef(0), no = useRef(0), you = useRef<number | null>(null), bot = useRef<number | null>(null), typed = useRef<string | null>(null);
  const t0 = useRef(0);
  const at = () => (t0.current ? (Date.now() - t0.current) / 1000 : 0);
  const add = (e: Omit<LogEntry, "id" | "at" | "no">) => {
    // Numbers are taken here, not inside the updater: StrictMode runs updaters twice.
    const entry = { ...e, id: ++seq.current, at: at(), no: e.kind === "sys" ? undefined : ++no.current };
    setEntries((l) => [...l, entry]);
    return entry.id;
  };
  const patch = (id: number, f: (e: LogEntry) => LogEntry) => setEntries((l) => l.map((e) => (e.id === id ? f(e) : e)));
  return {
    entries,
    /** The log's clock starts when the call connects (idempotent until clear). */
    start() { if (!t0.current) t0.current = Date.now(); },
    sys: (text: string, err?: boolean) => add({ kind: "sys", text, err }),
    typed(text: string) { add({ kind: "you", text }); typed.current = text; you.current = null; bot.current = null; },
    partial(text: string) {
      if (you.current == null) you.current = add({ kind: "you", text, live: true });
      else patch(you.current, (e) => ({ ...e, text }));
    },
    final(text: string) {
      const id = you.current;
      if (!text) { if (id != null) setEntries((l) => l.filter((e) => e.id !== id)); you.current = null; return; }
      // A typed message is already in the log; only spoken ones are added here.
      if (id != null) patch(id, (e) => ({ ...e, text, live: false }));
      else if (typed.current !== text) add({ kind: "you", text });
      typed.current = null; you.current = null; bot.current = null;
    },
    delta(d: string) {
      if (bot.current == null) bot.current = add({ kind: "bot", text: d, live: true });
      else patch(bot.current, (e) => ({ ...e, text: e.text + d }));
    },
    cut() { const id = bot.current; if (id != null) patch(id, (e) => ({ ...e, text: e.text + " —", live: false })); },
    settle() { const id = bot.current; if (id != null) patch(id, (e) => ({ ...e, live: false })); },
    clear() { setEntries([]); t0.current = 0; seq.current = 0; no.current = 0; you.current = bot.current = null; },
  };
}

export function VoicePicker({ value, onChange, className }: { value: string; onChange: (id: string) => void; className?: string }) {
  const { data: voices } = useCallVoices();
  return (
    <select
      aria-label="Voice"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 rounded-full border border-input bg-card px-3 text-sm", className)}
    >
      <option value="">Default voice</option>
      {(voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );
}

export function Compose({ disabled, onSend, floating = false }: { disabled: boolean; onSend: (t: string) => boolean; floating?: boolean }) {
  const [text, setText] = useState("");
  return (
    <form
      className={cn("flex items-end gap-2 p-3", floating ? "rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur" : "border-t border-border")}
      onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t && onSend(t)) setText(""); }}
    >
      <textarea
        rows={1}
        value={text}
        disabled={disabled}
        aria-label="Message"
        placeholder="Type a message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
        className="max-h-36 min-h-8 flex-1 resize-none rounded-md border border-input bg-field px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <Button type="submit" disabled={disabled || !text.trim()}>Send</Button>
    </form>
  );
}

export function TurnTable({ turns, info }: { turns: TurnStats[]; info: string }) {
  const cell = (v: number | null | undefined) => (v == null ? "–" : String(v));
  return (
    <div className="max-h-56 overflow-y-auto border-t border-border px-4 py-3 font-log text-2xs" data-testid="turn-stats">
      <div className="mb-1 text-muted-foreground">{info}</div>
      <table className="w-full">
        <thead className="text-muted-foreground"><tr><th className="text-left font-normal">No.</th><th className="font-normal">wait</th><th className="font-normal">→ text</th><th className="font-normal">→ LLM</th><th className="font-normal">→ audio</th><th className="font-normal">heard</th><th className="font-normal">VRAM</th></tr></thead>
        <tbody>
          {turns.map((t) => (
            <tr key={t.turn} className="text-center">
              <td className="text-left">{pad(t.turn)}{t.barged_in ? " ✕" : ""}{t.discarded ? " –" : ""}</td>
              <td>{cell(t.endpoint_wait_ms)}</td><td>{cell(t.eos_to_transcript_ms)}</td><td>{cell(t.eos_to_first_token_ms)}</td>
              <td className={cn(t.eos_to_first_audio_ms != null && t.target_ms != null && t.eos_to_first_audio_ms > t.target_ms && "text-danger")}>{cell(t.eos_to_first_audio_ms)}</td>
              <td>{cell(t.heard_ms)}</td><td>{cell(t.vram_peak_mib)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-muted-foreground">ms from the end of your speech. Target → audio: 500.</div>
    </div>
  );
}
