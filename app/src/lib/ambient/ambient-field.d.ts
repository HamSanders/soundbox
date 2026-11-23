/** Types for ambient-field.js, which stays plain JS so the splash and the
 *  cloud pages can load the same file without a build step. */

export type AmbientStyle = "smoke" | "liquid" | "gradient" | "pixel";

export interface AmbientPalette {
  /** The ground the panels sit on. */
  bg?: string;
  /** The brightest tone: the brand's signal colour. */
  c1?: string;
  c2?: string;
  c3?: string;
}

export interface AmbientFieldOptions {
  style?: AmbientStyle;
  palette?: AmbientPalette;
  /** 0..1, how strongly the style shows against the ground. */
  strength?: number;
  /** Polled each frame: [level, bass, high], each 0..1. */
  audio?: (() => readonly [number, number, number] | null) | null;
  /** Whether the pointer moves the field. Default true. */
  pointer?: boolean;
  /** Polled each frame by the pixel style: 16 bands, low to high, each 0..1. */
  bands?: (() => ArrayLike<number> | null) | null;
}

export interface AmbientField {
  setPalette(p: AmbientPalette): void;
  setStrength(v: number): void;
  /** False, keeping the current style, if the new one would not compile. */
  setStyle(style: AmbientStyle): boolean;
  setAudio(fn: AmbientFieldOptions["audio"]): void;
  setBands(fn: AmbientFieldOptions["bands"]): void;
  /** Off: the pointer stops moving the field and its trail clears. */
  setPointer(on: boolean): void;
  setScale(v: number): void;
  destroy(): void;
}

export function parseColor(input: string): [number, number, number] | null;
export function createAmbientField(canvas: HTMLCanvasElement, options?: AmbientFieldOptions): AmbientField | null;
