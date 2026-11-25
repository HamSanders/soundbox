import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useCallVoices } from "../queries";

/** Small typed label, the Mirli field-notebook voice. */
export function LogLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-log text-xs text-muted-foreground", className)}>{children}</span>;
}

export const STATE_WORDS: Record<string, string> = {
  off: "ready to call", starting: "connecting", idle: "your turn", listening: "listening", thinking: "thinking",
  speaking: "speaking", error: "error", closed: "call ended",
};

/** What to do when the live voice worker isn't running. */
export const WORKER_DOWN = "The live voice worker isn't running. Start the live voice worker: cd live/voice && npm start";

/** The voices a call can use: the live worker's list (Mirli's saved voices). */
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
      {/* A voice picked but not in the list (just made, or the worker is down) still shows. */}
      {value && !(voices ?? []).some((v) => v.id === value) ? <option value={value}>Saved voice</option> : null}
    </select>
  );
}
