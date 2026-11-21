/**
 * /tools/bpm-key-finder: tempo and key of a song, worked out in the browser,
 * laid out as a Mirli window (src/tools/shell.tsx).
 *
 * Nothing is uploaded: a dropped file, or a few seconds recorded from the
 * microphone, is decoded with the Web Audio API and analysed by
 * src/tools/analyze.ts on this machine.
 */

import { BookOpenIcon, FileAudioIcon, HelpCircleIcon, MicIcon, SlidersHorizontalIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { PeakGlyph } from "@/components/peak-glyph";
import { faqJsonLd, SeoHead } from "@/components/seo-head";
import { SiteDock, type SiteTrack, useSiteAudio } from "@/components/site/site-tracks";
import { Button } from "@/components/ui/button";
import { laneColor } from "@/lib/lanes";
import { cn } from "@/lib/utils";
import { type Analysis, analyze, mixDown } from "../../tools/analyze";
import { BeatArt, CAMELOT_KEYS, CamelotWheel, camelotNeighbours } from "../../tools/art";
import { decodeFile } from "../../tools/free-api";
import { listen, MicError, type MicSession } from "../../tools/mic";
import { Faq, PanelAction, PanelField, PanelHead, peaksOf, RowList, Section, ToolHero, ToolShell, TrackRow, Workspace } from "../../tools/shell";
import { DropZone, formatDuration, Funnel } from "../../tools/ui";

type Source = "file" | "mic";

type Phase =
  | { kind: "idle" }
  | { kind: "listening"; elapsed: number; level: number }
  | { kind: "working" }
  | { kind: "done"; result: Analysis }
  | { kind: "error"; message: string };

interface Heard {
  name: string;
  seconds: number;
  peaks: number[];
  /** A file plays back from the visitor's disk; a mic take isn't kept. */
  url?: string;
  fromMic: boolean;
}

const FAQ = [
  {
    question: "Is my song uploaded?",
    answer:
      "No. Your browser decodes and analyses the file, or the microphone recording, on your own computer. Nothing is sent anywhere.",
  },
  {
    question: "Can it listen through my microphone?",
    answer:
      "Yes. Switch to Microphone, press Listen, allow the microphone, and play the song out loud nearby for about 15 seconds. A file gives a cleaner result than a speaker in a noisy room, so use one if you have it.",
  },
  {
    question: "Why does it show two tempos?",
    answer:
      "Many songs read equally well at half or double time, like drum and bass at 174 or 87. The first number is the likelier one; the second is the half- or double-time reading.",
  },
  {
    question: "What's the Camelot code?",
    answer:
      "DJs use the Camelot wheel to mix in key: tracks with the same number, or one step apart, blend smoothly. 8B is C major, 8A is A minor. The wheel on this page lights up the keys that mix with yours.",
  },
  {
    question: "How accurate is it?",
    answer:
      "It's right on most pop, rock and electronic music. Songs that change key, have no steady beat, or sit between a major key and its relative minor can fool it, so the page shows how sure it is.",
  },
];

const MAX_ANALYSE_S = 180;
/** How long the microphone listens. Tempo needs a few bars; key settles in about ten seconds. */
const LISTEN_S = 15;
/** Shorter than this and the tempo reading is mostly noise. */
const MIN_LISTEN_S = 6;

export function BpmKeyFinderPage() {
  const [source, setSource] = useState<Source>("file");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [heard, setHeard] = useState<Heard | null>(null);
  const mic = useRef<MicSession | null>(null);

  // Close the microphone if the page is left mid-recording.
  useEffect(() => () => mic.current?.stop(), []);
  useEffect(() => () => (heard?.url ? URL.revokeObjectURL(heard.url) : undefined), [heard]);

  async function analyseBlob(blob: Blob, name: string, fromMic: boolean) {
    setPhase({ kind: "working" });
    let buffer: AudioBuffer;
    try {
      buffer = await decodeFile(blob);
    } catch {
      // A recording only fails to decode when the input sent no audio at all (a muted or virtual device).
      setPhase({
        kind: "error",
        message: fromMic
          ? "The microphone sent no sound. Check it's the right input and not muted, then try again."
          : "We couldn't read that file. Try an MP3, WAV, FLAC, M4A or OGG.",
      });
      return;
    }
    if (fromMic && buffer.duration < MIN_LISTEN_S - 0.5) {
      setPhase({ kind: "error", message: `That was too short to read. Let it listen for at least ${MIN_LISTEN_S} seconds.` });
      return;
    }
    // Yield so the "Analysing" state paints before the work starts.
    await new Promise((r) => setTimeout(r, 30));
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const mono = mixDown(chans);
    if (fromMic && rms(mono) < 0.003) {
      setPhase({ kind: "error", message: "The microphone heard almost nothing. Turn the music up or move closer, then try again." });
      return;
    }
    const len = Math.min(mono.length, buffer.sampleRate * MAX_ANALYSE_S);
    const from = Math.max(0, Math.floor((mono.length - len) / 2));
    const result = analyze(mono.subarray(from, from + len), buffer.sampleRate);
    setHeard({
      name,
      seconds: buffer.duration,
      peaks: peaksOf(buffer),
      url: fromMic ? undefined : URL.createObjectURL(blob),
      fromMic,
    });
    setPhase({ kind: "done", result });
  }

  async function startListening() {
    setHeard(null);
    setPhase({ kind: "listening", elapsed: 0, level: 0 });
    let session: MicSession;
    try {
      session = await listen(LISTEN_S, (elapsed, level) => setPhase({ kind: "listening", elapsed, level }));
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof MicError ? e.message : "Couldn't start the microphone." });
      return;
    }
    mic.current = session;
    let blob: Blob;
    try {
      blob = await session.done;
    } catch {
      setPhase({ kind: "error", message: "The recording failed. Try again." });
      return;
    } finally {
      mic.current = null;
    }
    await analyseBlob(blob, "Microphone", true);
  }

  function reset() {
    setHeard(null);
    setPhase({ kind: "idle" });
  }

  const busy = phase.kind === "working" || phase.kind === "listening";
  const result = phase.kind === "done" ? phase.result : null;
  const sure = (c: number) => (c > 0.66 ? "sure" : c > 0.33 ? "fairly sure" : "a guess");
  const title = heard ? (heard.fromMic ? "Heard live" : heard.name.replace(/\.[^.]+$/, "")) : "BPM and key";

  const queue = useMemo<SiteTrack[]>(
    () =>
      heard?.url
        ? [{ id: "song", title, sub: result ? `${Math.round(result.bpm)} BPM · ${result.key} ${result.mode}` : "", url: heard.url, durationS: heard.seconds, tile: <Tile peaks={heard.peaks} /> }]
        : [],
    [heard, result, title],
  );
  const player = useSiteAudio(queue);

  return (
    <ToolShell
      onThisPage={[
        { href: "#tool", label: "The tool", icon: SlidersHorizontalIcon },
        { href: "#questions", label: "Questions", icon: HelpCircleIcon },
        { href: "#mirli", label: "Get Mirli", icon: BookOpenIcon },
      ]}
    >
      <SeoHead
        title="Free BPM and key finder: tempo and key of any song | Mirli"
        description="Find the BPM and musical key of a song in your browser, from a file or through your microphone. Nothing is uploaded. Shows the Camelot code for DJs, plus half- and double-time tempos."
        path="/tools/bpm-key-finder"
        jsonLd={[
          faqJsonLd(FAQ),
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Mirli BPM and key finder",
            applicationCategory: "MultimediaApplication",
            operatingSystem: "Any (browser)",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
        ]}
      />
      {player.element}

      <ToolHero
        kicker="Free tool · BPM and key finder"
        title="Find the tempo and key of any song"
        lede="Drop in a track, or let it listen through your microphone, and get its BPM, key and Camelot code. It runs in your browser, so nothing is uploaded."
        facts={["Nothing uploaded", "Works with a mic", "Camelot codes", "Half and double time"]}
        art={<BeatArt bpm={result?.bpm ?? 120} />}
        lanes={[2, 4]}
      />

      <Workspace
        crumb="BPM and key"
        active="bpm-key-finder"
        side={
          <>
            <div role="radiogroup" aria-label="Listen to" className="bg-field border-border grid grid-cols-2 gap-1 rounded-md border p-1">
              {(
                [
                  ["file", "From a file", FileAudioIcon],
                  ["mic", "Microphone", MicIcon],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={source === value}
                  disabled={busy}
                  onClick={() => setSource(value)}
                  className={cn(
                    "inline-flex h-8 items-center justify-center gap-2 rounded-sm text-sm font-medium transition-colors disabled:opacity-50",
                    source === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            <PanelField label="Runs">In your browser</PanelField>

            {source === "file" ? (
              heard && !heard.fromMic ? (
                <div className="border-border bg-field flex items-center gap-3 rounded-md border p-3">
                  <span className="ring-border bg-muted flex size-11 shrink-0 items-center justify-center rounded-sm ring-1 ring-inset">
                    <PeakGlyph peaks={heard.peaks} className="text-foreground/70 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{heard.name}</p>
                    <p className="readout text-muted-foreground">{formatDuration(heard.seconds)}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Choose a different song" onClick={reset} disabled={busy}>
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <DropZone compact onFile={(f) => void analyseBlob(f, f.name, false)} disabled={busy} hint="MP3, WAV, FLAC, M4A or OGG. Stays on your computer." />
              )
            ) : (
              <MicPanel phase={phase} />
            )}

            {source === "mic" ? (
              <PanelAction
                icon={phase.kind === "listening" ? SquareIcon : MicIcon}
                onClick={() => (phase.kind === "listening" ? mic.current?.stop() : void startListening())}
                disabled={phase.kind === "working" || (phase.kind === "listening" && phase.elapsed < MIN_LISTEN_S)}
              >
                {phase.kind === "listening" ? (phase.elapsed < MIN_LISTEN_S ? "Listening…" : "Stop and read") : heard?.fromMic ? "Listen again" : "Listen"}
              </PanelAction>
            ) : (
              <p className="text-muted-foreground mt-auto pt-2 text-center text-xs">The reading starts as soon as you drop a file.</p>
            )}
          </>
        }
      >
        <PanelHead
          kicker="Analysis"
          title={title}
          log={
            phase.kind === "working"
              ? "Analysing…"
              : heard
                ? `${heard.fromMic ? "Through the microphone" : "From a file"} · ${formatDuration(heard.seconds)} · analysed on this computer`
                : "Tempo, key and Camelot code · nothing uploaded"
          }
        />

        <div aria-live="polite">
          <dl className="grid gap-2 sm:grid-cols-3">
            <ResultTile
              label="Tempo"
              lane={2}
              value={result ? String(Math.round(result.bpm)) : "—"}
              unit={result ? "BPM" : undefined}
              note={result ? `${sure(result.bpmConfidence)}${result.bpmAlt ? ` · or ${Math.round(result.bpmAlt)}` : ""}` : "beats per minute"}
              working={phase.kind === "working"}
            />
            <ResultTile
              label="Key"
              lane={4}
              value={result ? `${result.key}${result.mode === "minor" ? "m" : ""}` : "—"}
              note={result ? `${result.key} ${result.mode}, ${sure(result.keyConfidence)} · relative ${result.relative}` : "and its relative"}
              working={phase.kind === "working"}
            />
            <ResultTile
              label="Camelot"
              lane={0}
              value={result?.camelot ?? "—"}
              note="for mixing in key"
              working={phase.kind === "working"}
            />
          </dl>

          {phase.kind === "error" ? (
            <p role="alert" className="text-danger mt-4 text-sm">
              {phase.message}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-center">
            <div className="bg-dusk mx-auto aspect-square w-full max-w-60 rounded-md p-3">
              <CamelotWheel highlight={result?.camelot} className="size-full" />
            </div>
            <div className="min-w-0">
              {result ? (
                <>
                  <p className="label-caps text-muted-foreground">Mixes well with</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {camelotNeighbours(result.camelot).map((c) => (
                      <li key={c} className="border-border bg-field rounded-sm border px-2 py-1">
                        <span className="font-display text-lg font-extrabold">{c}</span>{" "}
                        <span className="readout text-muted-foreground">{CAMELOT_KEYS[c]}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex items-center gap-3">
                    <span
                      className="tools-anim tools-beat-dot bg-signal size-3 shrink-0 rounded-full"
                      style={{ animationDuration: `${60 / result.bpm}s` }}
                      aria-hidden="true"
                    />
                    <p className="text-muted-foreground text-sm">Flashing at {Math.round(result.bpm)} BPM. Tap along to check it.</p>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  The wheel lights up your track's key and the keys that mix cleanly with it: one step either way, and its relative major or
                  minor.
                </p>
              )}
            </div>
          </div>

          {heard?.url ? (
            <div className="mt-5">
              <RowList>
                <TrackRow
                  no="01"
                  tile={<Tile peaks={heard.peaks} />}
                  title={title}
                  log={`${heard.name} · stays on your computer`}
                  model="Mirli analyser"
                  length={formatDuration(heard.seconds)}
                  isCurrent={player.current?.id === "song"}
                  playing={player.playing}
                  onPlay={() => player.toggle("song")}
                />
              </RowList>
            </div>
          ) : null}

          {result ? (
            <>
              {!heard?.fromMic ? (
                <p className="text-muted-foreground mt-4 text-sm">
                  Want the vocals or the instrumental of this track?{" "}
                  <Link to="/tools/vocal-remover" className="text-foreground underline underline-offset-4">
                    Split it with the free vocal remover
                  </Link>
                  .
                </p>
              ) : (
                <p className="text-muted-foreground mt-4 text-sm">
                  Readings through a speaker are rougher than from a file. If it says “a guess”, listen again closer to the music.
                </p>
              )}
              <Funnel
                source="bpm-key-finder"
                title="Make the loop to go with it"
                body="Mirli makes music, sound effects and voices with AI models on your own computer, and splits songs into stems. Free and open source."
              />
            </>
          ) : null}
        </div>
      </Workspace>

      <Section id="questions" title="What people ask first">
        <Faq items={FAQ} />
      </Section>

      <Section id="mirli" title="Make music in the key you just found">
        <div className="border-border bg-card grid gap-6 rounded-md border p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            Mirli is a free, open-source audio app that runs AI models on your own machine. Give it a tempo and a key and it writes the loop,
            the bassline or the sound effect to match. Nothing is uploaded and there's nothing to pay.
          </p>
          <Button size="lg" asChild>
            <Link to="/download">Download Mirli</Link>
          </Button>
        </div>
      </Section>

      <style>{`
        @keyframes tools-beat-dot { 0% { transform: scale(1.7); opacity: 1; } 55%, 100% { transform: scale(1); opacity: 0.45; } }
        .tools-beat-dot { animation: tools-beat-dot 0.5s ease-out infinite; }
      `}</style>
      <SiteDock audio={player} />
    </ToolShell>
  );
}

/** One big result, on a tile like the app's tag shelves. */
function ResultTile({ label, value, unit, note, lane, working }: { label: string; value: string; unit?: string; note: string; lane: number; working: boolean }) {
  return (
    <div
      className={cn("ring-border relative flex min-h-36 flex-col justify-end overflow-hidden rounded-md p-4 ring-1 ring-inset", working && "tools-shimmer")}
      style={{ background: `linear-gradient(150deg, ${laneColor(lane, 0.42)}, ${laneColor(lane, 0.08)} 70%), var(--color-card)` }}
    >
      <dt className="label-caps text-foreground/70 absolute top-3 left-4">{label}</dt>
      {/* Not uppercase: "Am" is A minor, "AM" reads as a time of day. */}
      <dd className="font-display text-6xl leading-none font-extrabold tracking-[0.01em]">
        {value}
        {unit ? <span className="ml-1.5 text-2xl">{unit}</span> : null}
      </dd>
      <dd className="readout text-foreground/70 mt-1.5 truncate">{note}</dd>
    </div>
  );
}

function MicPanel({ phase }: { phase: Phase }) {
  if (phase.kind !== "listening") {
    return (
      <div className="border-border bg-field flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center">
        <MicIcon className="text-muted-foreground size-6" aria-hidden="true" />
        <p className="text-sm font-semibold tracking-tight">Play the song out loud near your microphone</p>
        <p className="text-muted-foreground text-xs">It listens for {LISTEN_S} seconds. The recording stays on this computer.</p>
      </div>
    );
  }
  return (
    <div className="border-border bg-field rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5" aria-hidden="true">
          <span className="bg-danger absolute inline-flex size-full animate-ping rounded-full opacity-60" />
          <span className="bg-danger relative inline-flex size-2.5 rounded-full" />
        </span>
        <p className="text-sm font-medium">Listening…</p>
        <span className="readout text-muted-foreground ml-auto tabular-nums">
          {Math.floor(phase.elapsed)} / {LISTEN_S} s
        </span>
      </div>
      {/* The input level as an EQ, so a too-quiet room is obvious before it fails. */}
      <div className="mt-4 flex h-12 items-end justify-between gap-1" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => {
          const shape = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + phase.elapsed * 6));
          return (
            <span
              key={i}
              className="w-full rounded-sm transition-[height] duration-75"
              style={{ height: `${Math.max(6, phase.level * shape * 100)}%`, background: laneColor(i < 6 ? 2 : i < 12 ? 4 : 0, 0.9) }}
            />
          );
        })}
      </div>
      <div
        className="bg-muted mt-3 h-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Listening"
        aria-valuemin={0}
        aria-valuemax={LISTEN_S}
        aria-valuenow={Math.round(phase.elapsed)}
      >
        <div className="bg-foreground h-full" style={{ width: `${(phase.elapsed / LISTEN_S) * 100}%` }} />
      </div>
    </div>
  );
}

function Tile({ peaks }: { peaks: number[] }) {
  return (
    <span className="flex size-full items-center justify-center" style={{ background: `linear-gradient(135deg, ${laneColor(2, 0.5)}, ${laneColor(4, 0.15)})` }}>
      <PeakGlyph peaks={peaks} className="text-foreground/80 h-5" />
    </span>
  );
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}
