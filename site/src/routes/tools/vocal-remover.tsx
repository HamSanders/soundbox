/**
 * /tools/vocal-remover: a free vocal remover in the browser, laid out as a
 * Mirli window (src/tools/shell.tsx).
 *
 * The song is checked here first (type, size, length), then sent to Mirli
 * Cloud, split on a GPU into vocals and instrumental with Mel-Band RoFormer,
 * and handed back as two MP3s. Uploads are deleted as soon as the split is
 * done; the results are deleted after 24 hours. The service decides how many
 * splits a visitor gets; this page only shows what it says.
 *
 * Tempo and key are worked out locally from the same decoded file
 * (src/tools/analyze.ts), so the page gives something useful even before
 * the split comes back. The original plays from the visitor's own disk.
 */

import { ArrowDownIcon, BookOpenIcon, CpuIcon, DownloadIcon, FileAudioIcon, HelpCircleIcon, ScissorsIcon, ShieldCheckIcon, SlidersHorizontalIcon, TrashIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { PeakGlyph } from "@/components/peak-glyph";
import { faqJsonLd, SeoHead } from "@/components/seo-head";
import { SiteDock, type SiteTrack, useSiteAudio } from "@/components/site/site-tracks";
import { Button } from "@/components/ui/button";
import { laneColor } from "@/lib/lanes";
import { type Analysis, analyze, mixDown } from "../../tools/analyze";
import { MUSIC_LANE, SplitArt, VOCAL_LANE } from "../../tools/art";
import { decodeFile, FreeError, freeStatus, guessMime, mountTurnstile, separate, type Stems, UPLOAD_HINTS } from "../../tools/free-api";
import { Faq, PanelAction, PanelField, PanelHead, peaksOf, RowList, Section, Steps, ToolHero, ToolShell, TrackRow, Workspace } from "../../tools/shell";
import { DropZone, formatDuration, Funnel } from "../../tools/ui";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "working"; stage: "uploading" | "queued" | "running"; fraction?: number }
  | { kind: "done"; stems: Stems }
  | { kind: "error"; message: string };

interface Song {
  file: File;
  seconds: number;
  peaks: number[];
  url: string;
}

const FAQ = [
  {
    question: "Is it really free?",
    answer:
      "Yes. There's no account and no watermark. There is a daily allowance per visitor so the GPU bill stays sane. Mirli on your own computer has no limit at all.",
  },
  {
    question: "What happens to my song?",
    answer:
      "It goes to our storage only to be split, and it's deleted as soon as the split is done. The vocals and instrumental are kept for 24 hours so you can download them, then deleted. We don't train on uploads, and nothing is published or shared.",
  },
  {
    question: "Which model does the splitting?",
    answer:
      "Mel-Band RoFormer, a source-separation model from the music demixing community, running on audio.cpp on a GPU. It's the same model Mirli runs on your computer.",
  },
  {
    question: "Can I get drums, bass and the other parts?",
    answer:
      "Not here: the free tool gives vocals and instrumental. Mirli on your computer runs more stem models, on your own machine, as often as you like.",
  },
  {
    question: "Can I use the result?",
    answer:
      "Only upload recordings you own or have the rights to process. Splitting a song doesn't change who owns it. For practice, karaoke at home or your own music, go ahead.",
  },
  {
    question: "Does it keep backing vocals in the karaoke track?",
    answer:
      "No. The instrumental has all the vocals removed, lead and backing. That's the right track for karaoke and for practising over.",
  },
];

const STEPS = [
  { icon: FileAudioIcon, title: "Your browser reads it", body: "The file is checked and its tempo and key worked out on your computer. That part never leaves it." },
  { icon: UploadIcon, title: "It goes up to be split", body: "The song is uploaded to our storage and handed to a GPU running Mel-Band RoFormer." },
  { icon: ScissorsIcon, title: "Two tracks come back", body: "The acapella for remixes and samples, and the instrumental for karaoke and practice, as MP3s." },
  { icon: TrashIcon, title: "Then it's deleted", body: "The upload goes as soon as the split is done. The two results go after 24 hours." },
];

const STEMS: { key: string; title: string; log: string; lane: number }[] = [
  { key: "vocals", title: "Vocals", log: "Acapella · MP3 320 kbps", lane: VOCAL_LANE },
  { key: "instrumental", title: "Instrumental", log: "Karaoke · MP3 320 kbps", lane: MUSIC_LANE },
];

const MODEL = "Mel-Band RoFormer";

export function VocalRemoverPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [open, setOpen] = useState<{ open: boolean; reason?: string } | null>(null);
  const [rights, setRights] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stemPeaks, setStemPeaks] = useState<Record<string, number[]>>({});
  const captcha = useRef<HTMLDivElement>(null);
  const resetCaptcha = useRef<() => void>(() => {});

  useEffect(() => {
    freeStatus()
      .then(setOpen)
      .catch(() => setOpen({ open: false, reason: "unreachable" }));
    if (captcha.current) {
      void mountTurnstile(captcha.current, setToken)
        .then((r) => (resetCaptcha.current = r))
        .catch(() => setToken(null));
    }
  }, []);

  // The original plays from a local object URL; let it go when the song changes.
  useEffect(() => () => (song ? URL.revokeObjectURL(song.url) : undefined), [song]);

  // Draw each stem's own glyph once it exists.
  useEffect(() => {
    if (phase.kind !== "done") return;
    let live = true;
    for (const [name, { url }] of Object.entries(phase.stems.stems)) {
      fetch(url)
        .then((r) => r.blob())
        .then(decodeFile)
        .then((b) => live && setStemPeaks((p) => ({ ...p, [name]: peaksOf(b) })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [phase]);

  async function onFile(file: File) {
    const mime = file.type || guessMime(file.name);
    if (!mime.startsWith("audio/")) {
      setPhase({ kind: "error", message: "That isn't an audio file. Use an MP3, WAV, FLAC, M4A or OGG." });
      return;
    }
    if (file.size > UPLOAD_HINTS.maxBytes) {
      setPhase({ kind: "error", message: "That file is too big for the free tool. Try an MP3, or split it in Mirli on your computer." });
      return;
    }
    setPhase({ kind: "checking" });
    setAnalysis(null);
    setStemPeaks({});
    let buffer: AudioBuffer;
    try {
      buffer = await decodeFile(file);
    } catch {
      setPhase({ kind: "error", message: "We couldn't read that file. Try an MP3 or WAV." });
      return;
    }
    if (buffer.duration > UPLOAD_HINTS.maxSeconds + 0.5) {
      setPhase({ kind: "error", message: `That song is ${formatDuration(buffer.duration)}, too long for the free tool. Mirli on your computer takes any length.` });
      return;
    }
    setSong({ file, seconds: buffer.duration, peaks: peaksOf(buffer), url: URL.createObjectURL(file) });
    setPhase({ kind: "idle" });
    // Tempo and key from up to a minute in the middle, off the main path.
    setTimeout(() => {
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const mono = mixDown(chans);
      const len = Math.min(mono.length, buffer.sampleRate * 60);
      const from = Math.max(0, Math.floor((mono.length - len) / 2));
      setAnalysis(analyze(mono.subarray(from, from + len), buffer.sampleRate));
    }, 0);
  }

  async function split() {
    if (!song || !token) return;
    if (!rights) {
      setPhase({ kind: "error", message: "Tick the box first to confirm you have the rights to this recording." });
      return;
    }
    setPhase({ kind: "working", stage: "uploading", fraction: 0 });
    try {
      const stems = await separate(song.file, song.seconds, token, (stage, fraction) => setPhase({ kind: "working", stage, fraction }));
      setPhase({ kind: "done", stems });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof FreeError ? e.message : "Something went wrong. Try again." });
      if (e instanceof FreeError && e.code === "closed") setOpen({ open: false, reason: "daily_limit" });
    } finally {
      // A Turnstile token is single use.
      setToken(null);
      resetCaptcha.current();
    }
  }

  function reset() {
    setSong(null);
    setAnalysis(null);
    setStemPeaks({});
    setPhase({ kind: "idle" });
  }

  const busy = phase.kind === "checking" || phase.kind === "working";
  const closed = open !== null && !open.open;
  const base = song ? song.file.name.replace(/\.[^.]+$/, "") : "";

  const queue = useMemo<SiteTrack[]>(() => {
    const q: SiteTrack[] = [];
    if (song) {
      q.push({ id: "original", title: base, sub: "Original · your file", url: song.url, durationS: song.seconds, tile: <Glyph peaks={song.peaks} /> });
    }
    if (phase.kind === "done") {
      for (const s of STEMS) {
        const url = phase.stems.stems[s.key]?.url;
        if (url) q.push({ id: s.key, title: `${base} · ${s.title}`, sub: s.log, url, durationS: song?.seconds, tile: <Glyph peaks={stemPeaks[s.key] ?? song?.peaks} lane={s.lane} /> });
      }
    }
    return q;
  }, [song, phase, stemPeaks, base]);
  const player = useSiteAudio(queue);

  const pendingLog =
    phase.kind === "checking"
      ? "Reading the file…"
      : phase.kind === "working"
        ? phase.stage === "uploading"
          ? `Uploading · ${Math.round((phase.fraction ?? 0) * 100)}%`
          : phase.stage === "queued"
            ? "Waiting for a GPU…"
            : "Separating…"
        : song
          ? "Ready to split"
          : "Waiting for a song";

  const actionLabel = !song
    ? "Split into stems"
    : phase.kind === "working"
      ? phase.stage === "uploading"
        ? `Uploading ${Math.round((phase.fraction ?? 0) * 100)}%`
        : phase.stage === "queued"
          ? "Waiting for a GPU…"
          : "Separating…"
      : phase.kind === "done"
        ? "Split another song"
        : !token
          ? "Checking you're human…"
          : "Split into stems";

  return (
    <ToolShell
      onThisPage={[
        { href: "#tool", label: "The tool", icon: SlidersHorizontalIcon },
        { href: "#how", label: "How it works", icon: CpuIcon },
        { href: "#questions", label: "Questions", icon: HelpCircleIcon },
        { href: "#mirli", label: "Get Mirli", icon: BookOpenIcon },
      ]}
    >
      <SeoHead
        title="Free AI vocal remover: split vocals and instrumental online | Mirli"
        description="Remove vocals from any song for free, in your browser. Get the acapella and the instrumental as MP3s in seconds, plus the tempo and key. No account, no watermark."
        path="/tools/vocal-remover"
        jsonLd={[
          faqJsonLd(FAQ),
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Mirli vocal remover",
            applicationCategory: "MultimediaApplication",
            operatingSystem: "Any (browser)",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
        ]}
      />
      {player.element}

      <ToolHero
        kicker="Free tool · Vocal remover"
        title="Remove the vocals from any song"
        lede="Drop in a song and get the acapella and the instrumental back as two MP3s, split by an AI model on a GPU. Tempo and key come free."
        facts={["No account", "No watermark", "MP3 320 kbps", "Deleted after 24 h"]}
        art={<SplitArt />}
        lanes={[VOCAL_LANE, MUSIC_LANE]}
      />

      <Workspace
        crumb="Vocal remover"
        active="vocal-remover"
        side={
          <>
            <PanelField label="Model">{MODEL}</PanelField>
            <PanelField label="Output">Vocals + instrumental, MP3</PanelField>

            {song ? (
              <div className="border-border bg-field flex items-center gap-3 rounded-md border p-3">
                <span className="ring-border bg-muted flex size-11 shrink-0 items-center justify-center rounded-sm ring-1 ring-inset">
                  <PeakGlyph peaks={song.peaks} className="text-foreground/70 h-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{song.file.name}</p>
                  <p className="readout text-muted-foreground">
                    {formatDuration(song.seconds)} · {(song.file.size / 1e6).toFixed(1)} MB
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="Choose a different song" onClick={reset} disabled={busy}>
                  <XIcon />
                </Button>
              </div>
            ) : (
              <DropZone compact onFile={onFile} disabled={busy || closed} hint="MP3, WAV, FLAC, M4A or OGG, up to 6 minutes" />
            )}

            <label className="border-border bg-field flex items-start gap-3 rounded-md border p-3 text-xs leading-relaxed">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="accent-foreground mt-0.5 size-4 shrink-0" />
              <span>
                <span className="text-foreground font-medium">I have the rights to this recording.</span>{" "}
                <span className="text-muted-foreground">The upload is deleted once it's split, the results after 24 hours.</span>
              </span>
            </label>

            <div ref={captcha} className="flex justify-center empty:hidden" />

            <PanelAction
              icon={phase.kind === "done" ? undefined : ScissorsIcon}
              onClick={phase.kind === "done" ? reset : () => void split()}
              disabled={closed || (phase.kind !== "done" && (!song || busy || !token))}
            >
              {actionLabel}
            </PanelAction>
          </>
        }
      >
        <PanelHead
          kicker="Stems"
          title={song ? base : "Vocal remover"}
          log={
            song
              ? `${formatDuration(song.seconds)} · ${analysis ? `${Math.round(analysis.bpm)} BPM · ${analysis.key} ${analysis.mode} · ${analysis.camelot}` : "reading tempo and key…"}`
              : "Vocals and instrumental · MP3 320 kbps · ready in seconds"
          }
        />

        {closed ? (
          <div className="border-border bg-field mb-4 rounded-md border p-4">
            <p className="font-semibold tracking-tight">
              {open?.reason === "paused"
                ? "The free vocal remover is paused right now."
                : open?.reason === "unreachable"
                  ? "We can't reach the vocal remover right now."
                  : "Today's free splits are used up."}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">Mirli splits songs on your own computer, free and with no limit.</p>
          </div>
        ) : null}

        <RowList>
          {song ? (
            <TrackRow
              no="01"
              tile={<Glyph peaks={song.peaks} />}
              title="Original"
              log={`${song.file.name} · stays on your computer`}
              model="—"
              length={formatDuration(song.seconds)}
              isCurrent={player.current?.id === "original"}
              playing={player.playing}
              onPlay={() => player.toggle("original")}
            />
          ) : (
            <TrackRow no="01" tile={null} title="Original" log="Waiting for a song" model="—" length="–:––" pending="waiting" />
          )}
          {STEMS.map((s, i) => {
            const url = phase.kind === "done" ? phase.stems.stems[s.key]?.url : undefined;
            const no = String(i + 2).padStart(2, "0");
            return url ? (
              <TrackRow
                key={s.key}
                no={no}
                tile={<Glyph peaks={stemPeaks[s.key] ?? song?.peaks} lane={s.lane} />}
                title={s.title}
                log={s.log}
                model={MODEL}
                length={song ? formatDuration(song.seconds) : ""}
                isCurrent={player.current?.id === s.key}
                playing={player.playing}
                onPlay={() => player.toggle(s.key)}
                actions={
                  <Button variant="ghost" size="sm" asChild>
                    <a href={url} download={`${base} - ${s.key}.mp3`} aria-label={`Download ${s.title} MP3`}>
                      <DownloadIcon />
                      <span className="max-sm:hidden">MP3</span>
                    </a>
                  </Button>
                }
              />
            ) : (
              <TrackRow
                key={s.key}
                no={no}
                tile={null}
                title={s.title}
                log={pendingLog}
                model={MODEL}
                length="–:––"
                pending={phase.kind === "working" || phase.kind === "checking" ? "working" : "waiting"}
              />
            );
          })}
        </RowList>

        <div aria-live="polite">
          {phase.kind === "error" ? (
            <p role="alert" className="text-danger mt-4 text-sm">
              {phase.message}
            </p>
          ) : null}
          {phase.kind === "done" ? (
            <>
              <p className="readout text-muted-foreground mt-4">
                Deleted {new Date(phase.stems.expires_at).toLocaleString()} · download what you want to keep
              </p>
              <Funnel
                source="vocal-remover"
                title="Want drums, bass and the rest?"
                body="Mirli runs more stem models on your own computer: free, offline and as many songs as you like. It also makes sound effects, music and voices."
              />
            </>
          ) : null}
        </div>
      </Workspace>

      <Section id="how" title="How it works" lede="Two tracks from one song, and nothing kept longer than it has to be.">
        <Steps steps={STEPS} />
      </Section>

      <Section id="questions" title="What people ask first">
        <Faq items={FAQ} />
      </Section>

      <Section id="mirli" title="The same thing, on your computer, with no limits">
        <div className="border-border bg-card grid gap-6 rounded-md border p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              Mirli is a free, open-source audio app that runs AI models on your own machine: stem splitting, sound effects, music and
              voices. Nothing is uploaded and there's nothing to pay.
            </p>
            <ul className="readout text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <li className="flex items-center gap-1.5">
                <ShieldCheckIcon className="size-3.5" aria-hidden="true" /> Offline
              </li>
              <li className="flex items-center gap-1.5">
                <ArrowDownIcon className="size-3.5" aria-hidden="true" /> Windows and macOS
              </li>
              <li className="flex items-center gap-1.5">
                <BookOpenIcon className="size-3.5" aria-hidden="true" /> MIT licence
              </li>
            </ul>
          </div>
          <Button size="lg" asChild>
            <Link to="/download">Download Mirli</Link>
          </Button>
        </div>
      </Section>

      <SiteDock audio={player} />
    </ToolShell>
  );
}

/** A row's tile: the sound's own glyph, on its lane's colour when it has one. */
function Glyph({ peaks, lane }: { peaks?: number[]; lane?: number }) {
  return (
    <span
      className="flex size-full items-center justify-center"
      style={lane === undefined ? undefined : { background: `linear-gradient(135deg, ${laneColor(lane, 0.55)}, ${laneColor(lane, 0.15)})` }}
    >
      <PeakGlyph peaks={peaks} className="text-foreground/80 h-5" />
    </span>
  );
}
