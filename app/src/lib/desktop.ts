/**
 * Bridge to the Tauri desktop shell.
 *
 * The web build runs standalone (no Tauri, no `window.__TAURI_INTERNALS__`),
 * so every call here is guarded by {@link isDesktop} first — invoking on the
 * plain web build would just reject, but callers should never get that far.
 */

import { isTauri, invoke } from "@tauri-apps/api/core";

export function isDesktop(): boolean {
  return isTauri();
}

/** Is the backend answering right now? */
export function getBackendHealth(): Promise<boolean> {
  return invoke<boolean>("backend_health");
}

/** Stop whatever backend we own (if any) and start a fresh one. */
export function restartBackend(): Promise<void> {
  return invoke<void>("restart_backend");
}

/** Which window frame the desktop shell gave us. Decides the title bar's
 *  layout: Windows and Linux windows have no native frame, so the bar draws
 *  its own window buttons on the right; macOS keeps its traffic lights, laid
 *  over the bar's left end. */
export type DesktopPlatform = "windows" | "macos" | "linux";

export function desktopPlatform(): DesktopPlatform {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  return "linux";
}

/**
 * The window this page is in, for the title bar's buttons and drag region.
 * Loaded on demand so the web build never pulls the window module in.
 * Every call needs a permission in src-tauri/capabilities/app-window.json.
 */
export async function appWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}
