/** Small presentation helpers shared across screens. */

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  // Stops at MB no longer: model downloads are the first thing here measured in
  // gigabytes, and "11097.5 MB" is a number you have to divide in your head
  // before it means anything.
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatHz(hz: number): string {
  return `${(hz / 1000).toFixed(1)} kHz`;
}

/**
 * File URL for a sound, honouring the user's preferred download format.
 *
 * `sound.file` always points at the stored WAV master; mp3 is a lazy
 * transcode the server produces on request via `?format=mp3`. wav stays the
 * bare URL rather than an explicit `?format=wav`, since that's what every
 * cached/pre-transcode reference to `sound.file` already looks like.
 */
export function soundFileUrl(file: string, format: "wav" | "mp3" | undefined): string {
  return format === "mp3" ? `${file}?format=mp3` : file;
}

export function soundDownloadName(name: string, format: "wav" | "mp3" | undefined): string {
  return `${name}.${format === "mp3" ? "mp3" : "wav"}`;
}

/**
 * Download a sound, respecting the user's mp3/wav preference.
 *
 * A plain `<a href>` can't be used for this: the browser's own navigation
 * can't read response headers, so there would be no way to tell a real mp3
 * from the server's silent wav fallback (Mirli doesn't bundle ffmpeg, so
 * that fallback is common). Fetching manually lets us check
 * X-Soundbox-Format-Fallback and say so, instead of handing over a .mp3
 * filename that's actually a wav with no explanation.
 *
 * Returns "mp3" | "wav" — the format actually delivered — so the caller can
 * decide whether it owes the user an explanation.
 */
export async function downloadSound(
  file: string,
  name: string,
  format: "wav" | "mp3" | undefined,
): Promise<"wav" | "mp3"> {
  const res = await fetch(soundFileUrl(file, format));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const fellBack = res.headers.get("X-Soundbox-Format-Fallback") === "wav";
  const delivered: "wav" | "mp3" = format === "mp3" && !fellBack ? "mp3" : "wav";
  saveBlob(await res.blob(), soundDownloadName(name, delivered));
  return delivered;
}

/** Hand a blob to the browser (or the desktop webview) as a file download:
 *  the anchor trick every export here uses. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A position on a timeline: `m:ss`, or `m:ss.d` with `tenths`.
 *
 * Unlike `formatDuration` it never changes shape with the value ("7.4s" under
 * ten seconds, "1:07" over a minute), so a clock that counts and the labels
 * along a ruler keep a steady width and read as one scale.
 */
export function formatClock(seconds: number, tenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // Rounded first, so 59.96 reads 1:00.0 and never 0:60.0.
  const total = tenths ? Math.round(seconds * 10) / 10 : Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const whole = String(Math.floor(s)).padStart(2, "0");
  return tenths ? `${m}:${whole}.${Math.round((s % 1) * 10) % 10}` : `${m}:${whole}`;
}
