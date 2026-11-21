/**
 * /tools/vocal-remover: a free vocal remover in the browser.
 *
 * The song is checked here first (type, size, length), then sent to Mirli
 * Cloud, split on a GPU into vocals and instrumental with Mel-Band RoFormer,
 * and handed back as two MP3s. Uploads are deleted as soon as the split is
 * done; the results are deleted after 24 hours. The service decides how many
 * splits a visitor gets; this page only shows what it says.
 *
 * Tempo and key are worked out locally from the same decoded file
 * (src/tools/analyze.ts), so the page gives something useful even before
 * the split comes back.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { faqJsonLd, SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { type Analysis, analyze, mixDown } from "../../tools/analyze";
import { decodeFile, FreeError, freeStatus, guessMime, mountTurnstile, separate, type Stems, UPLOAD_HINTS } from "../../tools/free-api";
import { Block, DownloadLink, DropZone, formatDuration, Funnel } from "../../tools/ui";

type Phase =
  | { kind: "idle" }
  | { kind: "checking"; name: string }
  | { kind: "working"; name: string; stage: "uploading" | "queued" | "running"; fraction?: number }
  | { kind: "done"; name: string; stems: Stems }
  | { kind: "error"; message: string };

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

export function VocalRemoverPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [open, setOpen] = useState<{ open: boolean; reason?: string } | null>(null);
  const [rights, setRights] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<(Analysis & { seconds: number }) | null>(null);
  const captcha = useRef<HTMLDivElement>(null);
  const resetCaptcha = useRef<() => void>(() => {});
  const pending = useRef<{ file: File; seconds: number } | null>(null);

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

  // A file dropped before the human check finished starts as soon as it does.
  useEffect(() => {
    if (token && pending.current) {
      const p = pending.current;
      pending.current = null;
      void start(p.file, p.seconds, token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function start(file: File, seconds: number, t: string) {
    setPhase({ kind: "working", name: file.name, stage: "uploading", fraction: 0 });
    try {
      const stems = await separate(file, seconds, t, (stage, fraction) => setPhase({ kind: "working", name: file.name, stage, fraction }));
      setPhase({ kind: "done", name: file.name, stems });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof FreeError ? e.message : "Something went wrong. Try again." });
      if (e instanceof FreeError && e.code === "closed") setOpen({ open: false, reason: "daily_limit" });
    } finally {
      // A Turnstile token is single use.
      setToken(null);
      resetCaptcha.current();
    }
  }

  async function onFile(file: File) {
    if (!rights) {
      setPhase({ kind: "error", message: "Tick the box first to confirm you have the rights to this recording." });
      return;
    }
    const mime = file.type || guessMime(file.name);
    if (!mime.startsWith("audio/")) {
      setPhase({ kind: "error", message: "That isn't an audio file. Use an MP3, WAV, FLAC, M4A or OGG." });
      return;
    }
    if (file.size > UPLOAD_HINTS.maxBytes) {
      setPhase({ kind: "error", message: "That file is too big for the free tool. Try an MP3, or split it in Mirli on your computer." });
      return;
    }
    setPhase({ kind: "checking", name: file.name });
    setAnalysis(null);
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
    // Tempo and key from up to a minute in the middle, off the main path.
    setTimeout(() => {
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const mono = mixDown(chans);
      const len = Math.min(mono.length, buffer.sampleRate * 60);
      const from = Math.max(0, Math.floor((mono.length - len) / 2));
      setAnalysis({ ...analyze(mono.subarray(from, from + len), buffer.sampleRate), seconds: buffer.duration });
    }, 0);
    if (!token) {
      pending.current = { file, seconds: buffer.duration };
      setPhase({ kind: "checking", name: file.name });
      return;
    }
    await start(file, buffer.duration, token);
  }

  const busy = phase.kind === "checking" || phase.kind === "working";
  const closed = open !== null && !open.open;
  const stemsOrder = phase.kind === "done" ? Object.keys(phase.stems.stems).sort((a) => (a === "vocals" ? -1 : 1)) : [];

  return (
    <main id="main">
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

      <section aria-labelledby="vr-h1" className="px-4">
        <div className="mx-auto w-full max-w-3xl py-14 text-center sm:py-20">
          <p className="label-caps text-muted-foreground">Free tool · Vocal remover</p>
          <h1 id="vr-h1" className="mt-4 text-4xl text-balance sm:text-6xl">
            Remove the vocals from any song
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Drop in a song and get the acapella and the instrumental back as two MP3s, split by an AI model on a GPU. No
            account, no watermark.
          </p>

          <div className="mt-10 text-left">
            {closed ? (
              <div className="border-border rounded-md border p-6 text-center">
                <p className="font-semibold tracking-tight">
                  {open?.reason === "paused"
                    ? "The free vocal remover is paused right now."
                    : open?.reason === "unreachable"
                      ? "We can't reach the vocal remover right now."
                      : "Today's free splits are used up."}
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  Mirli splits songs on your own computer, free and with no limit.
                </p>
              </div>
            ) : (
              <>
                <label className="mb-4 flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 size-4" />
                  <span>
                    I own this recording or have the rights to process it. The upload is deleted once it's split, and the results
                    after 24 hours.
                  </span>
                </label>
                <DropZone onFile={onFile} disabled={busy} hint="MP3, WAV, FLAC, M4A or OGG, up to 6 minutes" />
                <div ref={captcha} className="mt-3 flex justify-center" />
              </>
            )}

            <div aria-live="polite" className="mt-6">
              {phase.kind === "checking" ? <p className="text-muted-foreground text-sm">Reading {phase.name}…</p> : null}
              {phase.kind === "working" ? (
                <div>
                  <p className="text-sm">
                    {phase.stage === "uploading"
                      ? `Uploading ${phase.name}… ${Math.round((phase.fraction ?? 0) * 100)}%`
                      : phase.stage === "queued"
                        ? "Waiting for a GPU…"
                        : "Separating the vocals…"}
                  </p>
                  <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded">
                    <div
                      className="bg-foreground h-full transition-all"
                      style={{ width: `${phase.stage === "uploading" ? Math.round((phase.fraction ?? 0) * 60) : phase.stage === "queued" ? 65 : 85}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {phase.kind === "error" ? (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {phase.message}
                </p>
              ) : null}
              {phase.kind === "done" ? (
                <div className="space-y-5">
                  {stemsOrder.map((name) => (
                    <div key={name} className="border-border rounded-md border p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-semibold">{name === "vocals" ? "Vocals (acapella)" : name === "instrumental" ? "Instrumental (karaoke)" : name}</p>
                        <DownloadLink href={phase.stems.stems[name]!.url} name={`${phase.name.replace(/\.[^.]+$/, "")} - ${name}.mp3`} label="Download MP3" />
                      </div>
                      <audio controls preload="none" src={phase.stems.stems[name]!.url} className="w-full" />
                    </div>
                  ))}
                  <p className="text-muted-foreground text-xs">
                    These files are deleted {new Date(phase.stems.expires_at).toLocaleString()}.{" "}
                    <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setPhase({ kind: "idle" })}>
                      Split another song
                    </Button>
                  </p>
                </div>
              ) : null}
              {analysis ? (
                <p className="text-muted-foreground mt-4 text-sm">
                  <span className="text-foreground font-medium">{Math.round(analysis.bpm)} BPM</span>
                  {analysis.bpmAlt ? ` (or ${Math.round(analysis.bpmAlt)})` : ""} ·{" "}
                  <span className="text-foreground font-medium">
                    {analysis.key} {analysis.mode}
                  </span>{" "}
                  ({analysis.camelot}) · {formatDuration(analysis.seconds)} ·{" "}
                  <Link to="/tools/bpm-key-finder" className="underline underline-offset-4">
                    tempo and key finder
                  </Link>
                </p>
              ) : null}
            </div>

            {phase.kind === "done" ? (
              <Funnel
                source="vocal-remover"
                title="Want drums, bass and the rest?"
                body="Mirli runs more stem models on your own computer: free, offline and as many songs as you like. It also makes sound effects, music and voices."
              />
            ) : null}
          </div>
        </div>
      </section>

      <Block id="how" label="How it works" title="Two tracks from one song">
        <ol className="text-muted-foreground list-decimal space-y-3 pl-5 text-sm leading-relaxed">
          <li>Your browser checks the file and works out its tempo and key. That part never leaves your computer.</li>
          <li>The song is uploaded to our storage and split on a GPU by Mel-Band RoFormer into vocals and everything else.</li>
          <li>You get two MP3s: the acapella for remixes and samples, and the instrumental for karaoke and practice.</li>
          <li>The upload is deleted straight away; the two results are deleted after 24 hours.</li>
        </ol>
      </Block>

      <Block id="questions" label="Questions" title="What people ask first">
        <dl className="space-y-7">
          {FAQ.map((f) => (
            <div key={f.question}>
              <dt className="font-semibold tracking-tight">{f.question}</dt>
              <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.answer}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block id="mirli" label="Mirli" title="The same thing, on your computer, with no limits">
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Mirli is a free, open-source audio app that runs AI models on your own machine: stem splitting, sound effects,
          music and voices. Nothing is uploaded and there's nothing to pay.
        </p>
        <Funnel source="vocal-remover" title="Download Mirli" body="Windows and macOS. Free and open source." />
      </Block>
    </main>
  );
}
