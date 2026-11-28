/**
 * Start a cloud model's GPU before the user presses Generate.
 *
 * When the selected model runs on Mirli Cloud, tell the gateway once on
 * selection, then again at most once a minute while the user is still active
 * on the page (typing, clicking). The gateway keeps the GPU line warm for about
 * 90 s after each signal and ignores repeats for a line that is already warm,
 * so this costs a request a minute at most. A hint only: any failure is
 * ignored. Calls have their own warm-up and don't use this.
 */

import { useEffect } from "react";

import { api } from "@/lib/api";

const RESEND_MS = 60_000;

export function useCloudWarm(model: { id: string; provider?: string } | null | undefined): void {
  const id = model?.provider === "cloud" && model.id !== "cloud:transcribe" ? model.id : null;
  useEffect(() => {
    if (!id) return;
    let lastSent = 0;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      lastSent = Date.now();
      void api.cloudWarm(id).catch(() => undefined);
    };
    const onActive = () => {
      if (Date.now() - lastSent >= RESEND_MS) send();
    };
    send();
    const events = ["keydown", "pointerdown"] as const;
    for (const e of events) window.addEventListener(e, onActive, { passive: true });
    document.addEventListener("visibilitychange", onActive);
    return () => {
      for (const e of events) window.removeEventListener(e, onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [id]);
}
