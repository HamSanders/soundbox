/**
 * `/music/:slug` — one track's own page, and the only place a track plays.
 *
 * The hub lists every track and sends each click here, so this page has to
 * answer "what am I hearing" completely: the player, the script it was given,
 * the prompt that made it, and the render spec. No new data source — a deeper
 * URL into the same `MUSIC_TRACKS` array.
 *
 * Two things are load-bearing rather than decorative:
 *
 * - **The player is a fixed, full-width bottom dock.** It stays under the
 *   reader as they scroll through the lyrics and the spec, which is the whole
 *   point of reading along with something.
 * - **The script follows the playhead**, including while it is dragged, since
 *   `WaveformPlayer` reports position on a seek as well as during playback.
 *   Positions are evenly divided, not measured — see `parseScript`, and the
 *   note the page prints under the lyrics.
 *
 * The spec table is built from the manifest rather than the content file on
 * purpose: duration, sample rate and file size are facts about the artefact
 * on disk, and the requested duration next to the rendered one is the honest
 * way to show that diffusion models treat length as a target, not a contract.
 */

import { useCallback, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { DownloadIcon, MicVocalIcon, MusicIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/docs-primitives";
import { WaveformPlayer } from "@/components/waveform-player";
import { PlayerDock } from "@/components/player-dock";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead, breadcrumbJsonLd } from "@/components/seo-head";
import { MusicCover } from "@/components/music-cover";
import { MUSIC_TRACKS, trackBySlug } from "@/content/music/tracks";
import { MUSIC_MODEL_LICENSES, MUSIC_MODEL_NAMES } from "@/content/music/types";
import type { MusicTrack } from "@/content/music/types";
import {
  lineAt,
  parseScript,
  sungCount,
  trackAudioUrl,
  trackToSound,
  useMusicManifest,
} from "@/lib/music-track";
import { siteUrl } from "@/lib/asset-url";
import { GENERATOR_HREF } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/60 border-t py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function TrackBody({ track }: { track: MusicTrack }) {
  const { manifest, failed } = useMusicManifest();
  const meta = manifest?.[track.slug];
  const licence = MUSIC_MODEL_LICENSES[track.model];
  const siblings = MUSIC_TRACKS.filter(
    (t) => t.collection === track.collection && t.slug !== track.slug,
  );
  const kind = track.lyrics ? "sung" : "instrumental";

  const lines = track.lyrics ? parseScript(track.lyrics) : [];
  const totalLines = sungCount(lines);
  const [activeLine, setActiveLine] = useState(-1);
  const lineRef = useRef(-1);

  // Fires on every playhead move, mid-drag included. The line index is worked
  // out here and state is set only when it changes, so a scrub repaints two
  // list items instead of the page sixty times a second.
  const handleTime = useCallback(
    (seconds: number) => {
      if (!totalLines || !meta) return;
      const next = lineAt(seconds, meta.durationS, totalLines);
      if (next === lineRef.current) return;
      lineRef.current = next;
      setActiveLine(next);
    },
    [totalLines, meta],
  );

  return (
    <>
      <SeoHead
        title={`${track.title} (${track.genre}) | Konchi`}
        description={`Listen to "${track.title}", a ${track.genre.toLowerCase()} ${kind} track generated on one desktop GPU with ${MUSIC_MODEL_NAMES[track.model]}, and copy the exact prompt that made it.`}
        path={`/music/${track.slug}`}
        jsonLd={[
          breadcrumbJsonLd([
            { name: "Music", path: "/music" },
            { name: track.title, path: `/music/${track.slug}` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "MusicRecording",
            name: track.title,
            genre: track.genre,
            ...(meta ? { duration: `PT${Math.round(meta.durationS)}S` } : {}),
            audio: {
              "@type": "AudioObject",
              encodingFormat: "audio/mpeg",
              // Absolute when the site's origin is configured, else the
              // served path — either way including the deploy's base path.
              contentUrl: siteUrl(`/music/${track.slug}.mp3`) || trackAudioUrl(track.slug),
            },
          },
        ]}
      />

      {/* Bottom padding clears the dock, which is fixed and would otherwise
          sit on top of the last section. */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-36">
        <nav aria-label="Breadcrumb" className="text-muted-foreground pt-8 text-sm">
          <Link to="/music" className="hover:text-foreground underline-offset-4 hover:underline">
            Music
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-foreground">{track.title}</span>
        </nav>

        <header className="flex flex-col gap-6 py-8 sm:flex-row sm:items-end">
          <MusicCover
            track={track}
            className="bg-muted size-32 shrink-0 rounded-2xl object-cover shadow-sm sm:size-40"
            fallbackTextClassName="text-5xl"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                {track.lyrics ? (
                  <MicVocalIcon className="size-3" aria-hidden="true" />
                ) : (
                  <MusicIcon className="size-3" aria-hidden="true" />
                )}
                {track.genre}
              </Badge>
              {/* Only when the scene is narrower than the genre — "Corridos
                  tumbados" inside "Regional Mexican" earns a second badge,
                  "Phonk" inside "Phonk" would just be the same word twice. */}
              {track.scene && track.scene !== track.genre && (
                <Badge variant="secondary" className="text-[11px] font-normal">
                  {track.scene}
                </Badge>
              )}
              <span className="text-muted-foreground text-xs">
                {MUSIC_MODEL_NAMES[track.model]}
              </span>
            </div>
            <h1 className="font-heading mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {track.title}
            </h1>
            <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
              {track.lyrics
                ? "A sung track: the prompt below set the arrangement and the script is what the model was given to sing."
                : "An instrumental track, generated in a single pass on one desktop GPU."}{" "}
              Copy the prompt, change a word and render your own.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={trackAudioUrl(track.slug)} download>
                  <DownloadIcon />
                  Download MP3
                </a>
              </Button>
              <Button size="sm" asChild>
                <MarketingLink href={GENERATOR_HREF}>Generate a variation</MarketingLink>
              </Button>
            </div>
          </div>
        </header>

        {track.lyrics && (
          <section aria-labelledby="script" className="border-border/60 border-t py-10">
            <h2 id="script" className="font-heading text-xl font-semibold tracking-tight">
              The script
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              What ACE-Step was given to sing, verbatim. Press play and it follows along.
            </p>
            <ol className="mt-4 max-w-lg space-y-1">
              {lines.map((line, i) =>
                line.isTag ? (
                  <li
                    key={i}
                    className="text-muted-foreground/60 pt-3 font-mono text-[11px] tracking-wider uppercase first:pt-0"
                  >
                    {line.text}
                  </li>
                ) : (
                  <li
                    key={i}
                    aria-current={line.sungIndex === activeLine ? "true" : undefined}
                    className={cn(
                      "rounded-md px-2 py-1 transition-colors",
                      line.sungIndex === activeLine
                        ? "bg-primary/15 text-foreground font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {line.text}
                  </li>
                ),
              )}
            </ol>
            <div className="mt-4 flex items-start gap-2">
              <p className="text-muted-foreground/70 max-w-lg text-xs leading-relaxed">
                Line positions are the rendered length divided by {totalLines} lines. Neither
                model returns per-line timings and there is no forced aligner here, so the
                highlight follows the playhead approximately.
              </p>
              <CopyButton value={track.lyrics} label="Copy lyrics" className="shrink-0" />
            </div>
          </section>
        )}

        <section aria-labelledby="prompt" className="border-border/60 border-t py-10">
          <h2 id="prompt" className="font-heading text-xl font-semibold tracking-tight">
            The prompt
          </h2>
          <div className="bg-muted/50 ring-border mt-4 min-w-0 overflow-hidden rounded-xl ring-1 ring-inset">
            <div className="flex items-start justify-between gap-2 px-3 py-3">
              <p className="min-w-0 font-mono text-xs leading-relaxed">{track.prompt}</p>
              <CopyButton value={track.prompt} label="Copy prompt" className="shrink-0" />
            </div>
          </div>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{track.why}</p>
        </section>

        <section aria-labelledby="spec" className="border-border/60 border-t py-10">
          <h2 id="spec" className="font-heading text-xl font-semibold tracking-tight">
            How it was rendered
          </h2>
          <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <Spec label="Model" value={`${MUSIC_MODEL_NAMES[track.model]} (${track.model})`} />
            <Spec label="Licence" value={licence.name} />
            <Spec label="Duration requested" value={`${track.durationS} s`} />
            <Spec
              label="Duration rendered"
              value={meta ? `${meta.durationS.toFixed(2)} s` : "—"}
            />
            <Spec label="Sample rate" value={meta ? `${meta.sampleRate} Hz` : "—"} />
            <Spec
              label="File"
              value={meta ? `MP3, ${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "MP3"}
            />
          </dl>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {licence.note} Konchi itself is MIT and imposes no terms of its own on what you
            generate.
          </p>
        </section>

        {siblings.length > 0 && (
          <section aria-labelledby="more" className="border-border/60 border-t py-10">
            <h2 id="more" className="font-heading text-xl font-semibold tracking-tight">
              More {track.collection === "vocal" ? "sung tracks" : "instrumentals"}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {siblings.map((t) => (
                <li key={t.slug}>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/music/${t.slug}`}>{t.title}</Link>
                  </Button>
                </li>
              ))}
            </ul>
            <Link
              to="/music"
              className="text-muted-foreground hover:text-foreground mt-4 inline-block text-sm underline-offset-4 hover:underline"
            >
              Back to all tracks
            </Link>
          </section>
        )}
      </div>

      {/* The dock. Full width, pinned to the bottom, the only player here. */}
      <PlayerDock
        cover={
          <MusicCover
            track={track}
            className="bg-muted size-11 shrink-0 rounded-md object-cover"
            fallbackTextClassName="text-sm"
          />
        }
        title={track.title}
        subtitle={`${track.genre} · ${MUSIC_MODEL_NAMES[track.model]}`}
        player={
          failed ? (
            <p className="text-muted-foreground text-sm">This track could not be loaded.</p>
          ) : meta ? (
            <WaveformPlayer sound={trackToSound(track, meta)} onTime={handleTime} />
          ) : (
            <Skeleton className="h-14 w-full rounded-lg" />
          )
        }
        trailing={
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={trackAudioUrl(track.slug)} download aria-label={`Download ${track.title}`}>
              <DownloadIcon />
            </a>
          </Button>
        }
      />
    </>
  );
}

export function MusicTrackPage() {
  const { slug } = useParams();
  const track = trackBySlug(slug ?? "");

  // An unknown slug falls back to the hub rather than rendering an empty
  // template — same rule as the /sfx pages. The static build emits no file
  // for it at all, so a real host answers 404.
  if (!track) return <Navigate to="/music" replace />;

  return (
    <div className="bg-background text-foreground min-h-svh">
      {/* Keyed so switching tracks via the sibling links resets the script
          highlight and remounts the player on the new peaks. */}
      <TrackBody key={track.slug} track={track} />
    </div>
  );
}
