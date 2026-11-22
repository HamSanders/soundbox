/** Types for ambient-field.js, which stays plain JS so the splash and the
 *  cloud pages can load the same file without a build step. */

export interface AmbientPalette {
  /** The ground the panels sit on. */
  bg?: string;
  /** The bright pool: the brand's signal colour. */
  c1?: string;
  c2?: string;
  c3?: string;
}

export interface AmbientFieldOptions {
  palette?: AmbientPalette;
  /** 0..1, how far the pools reach from the ground. Default 0.35. */
  strength?: number;
  /** Render resolution against CSS pixels. Default 0.4. */
  scale?: number;
  /** Polled each frame: [level, bass, high], each 0..1. */
  audio?: (() => readonly [number, number, number] | null) | null;
}

export interface AmbientField {
  setPalette(p: AmbientPalette): void;
  setStrength(v: number): void;
  setAudio(fn: AmbientFieldOptions["audio"]): void;
  setScale(v: number): void;
  destroy(): void;
}

export function parseColor(input: string): [number, number, number] | null;
export function createAmbientField(canvas: HTMLCanvasElement, options?: AmbientFieldOptions): AmbientField | null;
