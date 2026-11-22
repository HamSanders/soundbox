/** Per-browser conveniences (voice, tile shape, log column, text size, call count). Never required. */
const KEY = "mirli-live:";

export const prefs = {
  get(k: string): string | null {
    try { return localStorage.getItem(KEY + k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(KEY + k, v); } catch { /* private mode */ }
  },
};

/** Every call gets a log number, like every Mirli thing. */
export function nextCallNo(): number {
  return Number(prefs.get("call-no") || 0) + 1;
}
export function bookCallNo(n: number) {
  prefs.set("call-no", String(n));
}

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${pad(Math.floor(seconds % 60))}`;
