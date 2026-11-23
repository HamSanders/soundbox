/**
 * The moving ground under the app's panels: see lib/ambient/ambient-field.js
 * for the styles and how they move, and lib/ambient/audio-bus.ts for what
 * they hear.
 *
 * It sits behind everything (`-z-10`, no pointer events) and only shows where
 * nothing is drawn on top: the gaps around the panels, behind the sidebar's
 * navigation and under the player strip. Panels keep their solid fills, so
 * text never sits on a moving picture.
 *
 * Which style, and whether it reacts to the pointer and sound, are per-browser preferences
 * (`ui-prefs`, Settings → Interface). Colours come from the theme
 * (`--ambient-ground`, `--ambient-<style>-1..3` and `-strength` in
 * index.css) and are read again when the theme or the style changes.
 */

import { useEffect, useRef } from "react";

import { createAmbientField, type AmbientField, type AmbientStyle } from "@/lib/ambient/ambient-field.js";
import { installAmbientAudio, readAmbientBands, readAmbientLevels } from "@/lib/ambient/audio-bus";
import { useUiPrefs } from "@/lib/ui-prefs";

function readLook(style: AmbientStyle) {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    palette: {
      bg: v("--ambient-ground"),
      c1: v(`--ambient-${style}-1`),
      c2: v(`--ambient-${style}-2`),
      c3: v(`--ambient-${style}-3`),
    },
    strength: Number.parseFloat(v(`--ambient-${style}-strength`)) || 0.2,
  };
}

export function AmbientBackground() {
  const background = useUiPrefs((s) => s.background);
  const reactive = useUiPrefs((s) => s.backgroundReactive);
  if (background === "none") return null;
  return <Field style={background} reactive={reactive} />;
}

function Field({ style, reactive }: { style: AmbientStyle; reactive: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const field = useRef<AmbientField | null>(null);
  // The latest style, for the theme watcher. Declared before the effect that
  // creates the field so it is current by the time that one runs.
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  // One WebGL context for the life of the component; a style change swaps
  // the shader in place rather than making a new context.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    installAmbientAudio();
    const look = readLook(styleRef.current);
    const f = createAmbientField(canvas, { style: styleRef.current, ...look });
    if (!f) {
      canvas.hidden = true;
      return;
    }
    field.current = f;
    const themeWatch = new MutationObserver(() => {
      const next = readLook(styleRef.current);
      f.setPalette(next.palette);
      f.setStrength(next.strength);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      themeWatch.disconnect();
      f.destroy();
      field.current = null;
    };
  }, []);

  useEffect(() => {
    const f = field.current;
    if (!f) return;
    f.setStyle(style);
    const look = readLook(style);
    f.setPalette(look.palette);
    f.setStrength(look.strength);
  }, [style]);

  useEffect(() => {
    const f = field.current;
    if (!f) return;
    // Reactive covers both the pointer and sound; off, the field just drifts.
    f.setPointer(reactive);
    f.setAudio(reactive ? readAmbientLevels : null);
    f.setBands(reactive ? readAmbientBands : null);
  }, [reactive]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 size-full"
    />
  );
}
