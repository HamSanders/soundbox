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

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { DownloadIcon, MicVocalIcon, MusicIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SitePanel } from "@/components/site/site-frame";
import { CopyButton } from "@/components/docs-primitives";
import {
  SiteCollectionHeader,
  SiteDock,
  SiteFactLog,
  SitePlayButton,
  SiteTrackList,
  SiteTrackRow,
  useSiteAudio,
} from "@/components/site/site-tracks";
import { getModelByCatalogId } from "@/content/models/models";
import { formatDuration } from "@/lib/format";
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
  useMusicManifest,
} from "@/lib/music-track";
import { siteUrl } from "@/lib/asset-url";
import { GENERATOR_HREF } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

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
  const id = `music-${track.slug}`;
  // This track first, then its siblings, so the rows under "More" play here too.
  const audio = useSiteAudio(
    [track, ...siblings].map((t) => ({
      id: `music-${t.slug}`,
      title: t.title,
      sub: `${t.genre} · ${MUSIC_MODEL_NAMES[t.model]}`,
      url: trackAudioUrl(t.slug),
      href: t.slug === track.slug ? undefined : `/music/${t.slug}`,
      tile: <MusicCover track={t} className="bg-muted size-full object-cover" fallbackTextClassName="text-sm" />,
      durationS: manifest?.[t.slug]?.durationS ?? t.durationS,
    })),
    id,
  );
  const isPlaying = audio.current?.id === id && audio.playing;
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
  useEffect(() => {
    if (audio.current?.id === id) handleTime(audio.time);
  }, [audio.time, audio.current?.id, id, handleTime]);

  return (
    <>
      <SeoHead
        title={`${track.title} (${track.genre}) | Mirli`}
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
        <SiteCollectionHeader
          tile={<MusicCover track={track} className="bg-muted size-full object-cover" fallbackTextClassName="text-5xl" />}
          kicker={
            <span className="inline-flex items-center gap-1.5">
              {track.lyrics ? (
                <MicVocalIcon className="size-3" aria-hidden="true" />
              ) : (
                <MusicIcon className="size-3" aria-hidden="true" />
              )}
              {track.lyrics ? "Sung track" : "Instrumental"}
            </span>
          }
          title={track.title}
          log={[
            track.genre,
            // Only when the scene is narrower than the genre.
            track.scene && track.scene !== track.genre ? track.scene : null,
            MUSIC_MODEL_NAMES[track.model],
            meta ? formatDuration(meta.durationS) : `${track.durationS}s requested`,
          ]
            .filter(Boolean)
            .join(" · ")}
          lede={
            <>
              {track.lyrics
                ? "A sung track: the prompt below set the arrangement and the script is what the model was given to sing."
                : "An instrumental track, generated in a single pass on one desktop GPU."}{" "}
              Copy the prompt, change a word and render your own.
            </>
          }
        >
          <SitePlayButton playing={isPlaying} onClick={() => audio.toggle(id)} label={track.title} size="icon-lg" />
          <Button variant="outline" size="sm" asChild>
            <a href={trackAudioUrl(track.slug)} download>
              <DownloadIcon />
              Download MP3
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <MarketingLink href={GENERATOR_HREF}>Generate a variation</MarketingLink>
          </Button>
        </SiteCollectionHeader>

        {failed && <p className="text-muted-foreground mb-8 text-sm">This track could not be loaded.</p>}

        {track.lyrics && (
          <section aria-labelledby="script" className="border-border/60 border-t py-10">
            <h2 id="script" className="font-display text-2xl leading-none font-extrabold uppercase">
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
                    className="label-caps text-muted-foreground/60 pt-3 first:pt-0"
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
                        ? "bg-muted text-foreground font-medium"
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
          <h2 id="prompt" className="font-display text-2xl leading-none font-extrabold uppercase">
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
          <h2 id="spec" className="font-display text-2xl leading-none font-extrabold uppercase">
            How it was rendered
          </h2>
          <div className="mt-4">
            <SiteFactLog
              facts={[
                { label: "Model", value: `${MUSIC_MODEL_NAMES[track.model]} (${track.model})` },
                { label: "Licence", value: licence.name },
                { label: "Duration requested", value: `${track.durationS} s` },
                { label: "Duration rendered", value: meta ? `${meta.durationS.toFixed(2)} s` : "—" },
                { label: "Sample rate", value: meta ? `${meta.sampleRate} Hz` : "—" },
                {
                  label: "File",
                  value: meta ? `MP3, ${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "MP3",
                },
              ]}
            />
          </div>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {licence.note} Mirli itself is MIT and imposes no terms of its own on what you
            generate.
          </p>
        </section>

        {siblings.length > 0 && (
          <section aria-labelledby="more" className="border-border/60 border-t py-10">
            <h2 id="more" className="font-display text-2xl leading-none font-extrabold uppercase">
              More {track.collection === "vocal" ? "sung tracks" : "instrumentals"}
            </h2>
            <SiteTrackList className="mt-4">
              {siblings.map((t, i) => {
                const sid = `music-${t.slug}`;
                return (
                  <SiteTrackRow
                    key={t.slug}
                    no={String(i + 1).padStart(2, "0")}
                    tile={<MusicCover track={t} className="bg-muted size-full object-cover" fallbackTextClassName="text-sm" />}
                    title={t.title}
                    href={`/music/${t.slug}`}
                    log={[t.genre, MUSIC_MODEL_LICENSES[t.model].name].join(" · ")}
                    license={getModelByCatalogId(t.model)?.license.commercial}
                    model={MUSIC_MODEL_NAMES[t.model]}
                    length={manifest?.[t.slug] ? formatDuration(manifest[t.slug]!.durationS) : `${t.durationS}s`}
                    isCurrent={audio.current?.id === sid}
                    playing={audio.playing}
                    onPlay={() => audio.toggle(sid)}
                  />
                );
              })}
            </SiteTrackList>
            <Link
              to="/music"
              className="text-muted-foreground hover:text-foreground mt-4 inline-block text-sm underline-offset-4 hover:underline"
            >
              Back to all tracks
            </Link>
          </section>
        )}
      </div>

      {/* The dock, as the app's: pinned to the bottom, the only player here. */}
      <SiteDock
        audio={audio}
        trailing={
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={trackAudioUrl(track.slug)} download aria-label={`Download ${track.title}`}>
              <DownloadIcon />
            </a>
          </Button>
        }
      />
      {audio.element}
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
    <SitePanel>
      {/* Keyed so switching tracks via the sibling links resets the script
          highlight and remounts the player on the new peaks. */}
      <TrackBody key={track.slug} track={track} />
    </SitePanel>
  );
}
