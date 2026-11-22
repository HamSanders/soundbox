/**
 * The moving ground under the app's panels: see lib/ambient/ambient-field.js
 * for how it looks and moves, and lib/ambient/audio-bus.ts for what it hears.
 *
 * It sits behind everything (`-z-10`, no pointer events) and only shows where
 * nothing is drawn on top: the gaps around the floating panels, and between
 * the studio's own panels. Panels keep their solid fills, so text never sits
 * on a moving picture.
 *
 * Colours come from the theme (`--ambient-ground`, `--ambient-1..3` in
 * index.css) and are read again whenever the theme class changes.
 */

import { useEffect, useRef } from "react";

import { createAmbientField } from "@/lib/ambient/ambient-field.js";
import { installAmbientAudio, readAmbientLevels } from "@/lib/ambient/audio-bus";

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    palette: { bg: v("--ambient-ground"), c1: v("--ambient-1"), c2: v("--ambient-2"), c3: v("--ambient-3") },
    strength: Number.parseFloat(v("--ambient-strength")) || 0.3,
  };
}

export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    installAmbientAudio();
    const { palette, strength } = readPalette();
    const field = createAmbientField(canvas, { palette, strength, audio: readAmbientLevels });
    if (!field) {
      canvas.hidden = true;
      return;
    }
    const themeWatch = new MutationObserver(() => {
      const next = readPalette();
      field.setPalette(next.palette);
      field.setStrength(next.strength);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      themeWatch.disconnect();
      field.destroy();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 size-full"
    />
  );
}
