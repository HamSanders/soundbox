/**
 * Just enough SFZ to play the VSCO 2 Community Edition instruments.
 *
 * SFZ is a large format, and this is not a general player. It reads the
 * opcodes the curated VSCO 2 CE instruments use (counted across their .sfz
 * files before this was written) and nothing else:
 *
 *   headers   <control> <global> <group> <region>
 *   control   default_path
 *   region    sample lokey hikey pitch_keycenter lovel hivel volume tune
 *   envelope  ampeg_attack ampeg_release
 *
 * The library also uses `ampeg_dynamic`, `seq_length`, `seq_position` and
 * `group_label`. They change nothing here: `ampeg_dynamic` re-evaluates the
 * envelope when a CC moves mid-note, which an offline render with no CCs never
 * does, and every group sets `seq_length=1`, which is one round-robin slot, i.e.
 * none. They are recorded in `ignored` rather than rejected, so a test can say
 * exactly which opcodes were skipped.
 *
 * No loops: VSCO 2 CE's sustains are long single recordings with no
 * `loop_mode`, so a note held past the end of its sample stops when the sample
 * does.
 */

/** One playable zone: a sample, the keys and velocities it answers to, and how
 *  to tune and level it. Field names are the SFZ opcodes in camelCase. */
export interface SfzRegion {
  /** Path relative to the .sfz file, forward slashes, `default_path` applied. */
  sample: string;
  lokey: number;
  hikey: number;
  /** The key the sample was recorded at. */
  pitchKeycenter: number;
  lovel: number;
  hivel: number;
  /** dB. VSCO uses it to bring quiet velocity layers up to level. */
  volume: number;
  /** Cents. */
  tune: number;
  /** Seconds. */
  ampegAttack: number;
  ampegRelease: number;
}

export interface SfzInstrument {
  regions: SfzRegion[];
  /** Opcodes seen and deliberately not implemented. */
  ignored: string[];
}

/** Opcodes that are read. Anything else parses but is recorded as ignored. */
const NUMERIC: Record<string, keyof SfzRegion> = {
  lokey: "lokey",
  hikey: "hikey",
  pitch_keycenter: "pitchKeycenter",
  lovel: "lovel",
  hivel: "hivel",
  volume: "volume",
  tune: "tune",
  ampeg_attack: "ampegAttack",
  ampeg_release: "ampegRelease",
};

/** The SFZ spec's defaults for the opcodes above. */
const DEFAULTS: Omit<SfzRegion, "sample"> = {
  lokey: 0,
  hikey: 127,
  pitchKeycenter: 60,
  lovel: 1,
  hivel: 127,
  volume: 0,
  tune: 0,
  ampegAttack: 0,
  ampegRelease: 0.001,
};

type Opcodes = Record<string, string>;

/**
 * Parse an .sfz file's text.
 *
 * Opcodes inherit downwards: a `<region>` takes what its `<group>` set, which
 * takes what `<global>` set. A value runs to the next opcode or the end of the
 * line, so a sample name with a space in it survives.
 */
export function parseSfz(text: string): SfzInstrument {
  const regions: SfzRegion[] = [];
  const ignored = new Set<string>();

  let header = "";
  const control: Opcodes = {};
  let global: Opcodes = {};
  let group: Opcodes = {};
  let region: Opcodes | null = null;

  const closeRegion = (): void => {
    if (!region) return;
    const merged = { ...global, ...group, ...region };
    region = null;
    const sample = merged.sample;
    if (!sample) return;
    const out: SfzRegion = { ...DEFAULTS, sample: joinSample(control.default_path, sample) };
    for (const [opcode, value] of Object.entries(merged)) {
      const field = NUMERIC[opcode];
      if (field) {
        const n = Number(value);
        if (Number.isFinite(n)) (out[field] as number) = n;
      } else if (opcode !== "sample") {
        ignored.add(opcode);
      }
    }
    regions.push(out);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "");
    // A line can hold headers and opcodes together: `<region> sample=a.wav`.
    for (const part of line.split(/(<[a-z_]+>)/)) {
      const tag = /^<([a-z_]+)>$/.exec(part);
      if (tag) {
        closeRegion();
        header = tag[1]!;
        if (header === "global") global = {};
        else if (header === "group") group = {};
        else if (header === "region") region = {};
        continue;
      }
      const target =
        header === "region"
          ? region
          : header === "group"
            ? group
            : header === "global"
              ? global
              : header === "control"
                ? control
                : null;
      if (!target) continue;
      for (const [opcode, value] of opcodesIn(part)) {
        if (header === "control" && opcode !== "default_path") ignored.add(opcode);
        target[opcode] = value;
      }
    }
  }
  closeRegion();

  return { regions, ignored: [...ignored].sort() };
}

/** `a=1 b=two words c=3` → [[a,1],[b,"two words"],[c,3]]. */
function opcodesIn(segment: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([a-z_][a-z0-9_]*)=/gi;
  const starts: { name: string; at: number; valueAt: number }[] = [];
  for (let m = re.exec(segment); m; m = re.exec(segment)) {
    // An `=` inside a value (rare, but legal in a file name) is not an opcode
    // unless whitespace or the line start precedes the name.
    if (m.index > 0 && !/\s/.test(segment[m.index - 1]!)) continue;
    starts.push({ name: m[1]!.toLowerCase(), at: m.index, valueAt: m.index + m[0].length });
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1]!.at : segment.length;
    out.push([starts[i]!.name, segment.slice(starts[i]!.valueAt, end).trim()]);
  }
  return out;
}

function joinSample(defaultPath: string | undefined, sample: string): string {
  const joined = `${defaultPath ?? ""}${sample}`.replace(/\\/g, "/");
  return joined.replace(/^\.\//, "");
}
