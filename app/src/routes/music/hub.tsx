/**
 * `/music` — the music landing page.
 *
 * An index, and only an index. Laid out after a streaming-dashboard reference
 * — hero, cover row, numbered track lists — but every track leads to its own
 * page rather than opening in place: `/music/:slug` is the page that carries
 * the player, the script and the render spec, and it is the page a search
 * result should land on. Duplicating any of that here would mean two surfaces
 * telling the same story and one of them going stale.
 *
 * What stays on the rows is the prompt. It is the only thing on this page a
 * competitor's grid of clips does not have, and it belongs in the markup of
 * the page that lists them all, not only on the pages behind them.
 *
 * Content lives in `@/content/music/tracks.ts`; this file decides only how it
 * is rendered. Like the `/sfx` pages it renders outside the app shell and must
 * keep working with no backend behind it — the static site build has none.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRightIcon,
  BotIcon,
  Disc3Icon,
  MicVocalIcon,
  MusicIcon,
  ScaleIcon,
  GaugeIcon,
  WifiOffIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/docs-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { WaveformPlayer } from "@/components/waveform-player";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead, breadcrumbJsonLd, faqJsonLd } from "@/components/seo-head";
import { MusicCover } from "@/components/music-cover";
import { RevealMusicFlow } from "@/components/reveal-music-flow";
import {
  FEATURED_SLUG,
  MUSIC_TRACKS,
  RECOMMENDED_SLUGS,
  trackBySlug,
  tracksIn,
  trendingTracks,
} from "@/content/music/tracks";
import { LABEL, MUSIC_ARTISTS, catalogNumber } from "@/content/music/artists";
import type { MusicArtist } from "@/content/music/artists";
import { MUSIC_MODEL_LICENSES, MUSIC_MODEL_NAMES } from "@/content/music/types";
import type { MusicTrack } from "@/content/music/types";
import { artistToSound, useArtistManifest, useMusicManifest } from "@/lib/music-track";
import type { MusicManifest, MusicTrackMeta } from "@/lib/music-track";
import { formatDuration } from "@/lib/format";
import { GENERATOR_HREF, MODELS_HUB_HREF, REPO_URL } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/asset-url";


const FAQS = [
  {
    question: "Can I use this music in a commercial game or video?",
    answer:
      "It depends on which model rendered the track; every row names it. The instrumentals come from Stable Audio 3.0 Small Music, under the Stability AI Community License: free for commercial use below USD $1M annual revenue, Enterprise licence required above it. The sung tracks come from ACE-Step, listed as Apache 2.0 but flagged unverified in the model catalogue, so read its model card before shipping. Konchi itself is MIT and imposes no terms on what you generate.",
  },
  {
    question: "How long can a generated track be?",
    answer:
      "Stable Audio 3.0 Small Music renders up to 120 seconds in one pass and ACE-Step up to 60. Everything on this page is about 20 seconds, loop or cue length. For anything longer than the limit, generate sections and arrange them.",
  },
  {
    question: "Which model should I use for music with vocals?",
    answer:
      "ACE-Step. Stable Audio has no vocal path and cannot sing words; ask it for a chorus and you get an instrumental with a lead line where the voice would be. ACE-Step takes a separate lyrics field and sings it verbatim, and the prompt sets genre and instrumentation.",
  },
  {
    question: "Does this run in the cloud?",
    answer:
      "No. Both models run on your own machine through audio.cpp, a native binary, from quantised GGUF weights. There is no Python stack, account, API key or per-track billing. Once the weights are downloaded it works with the network off. The tracks on this page were rendered this way on one desktop GPU.",
  },
  {
    question: "Why do the durations not match what was requested?",
    answer:
      "Every track here asked for 20 seconds and came back between 10.7 and 20.0. Diffusion audio models render to a latent length that maps only approximately to seconds, so the requested duration is a target. If you need an exact length, generate longer than you need and trim.",
  },
  {
    question: "Can an agent generate these instead of me?",
    answer:
      "Yes. Konchi exposes an MCP server, so a coding agent can call konchi.generate with a prompt and a lyrics block and get back an absolute path to a WAV it can drop into a project. Every track on this page was produced through the HTTP API that server is built on.",
  },
];

const CRAFT = [
  {
    icon: MusicIcon,
    heading: "Name the instruments and how they are played",
    body: "“Epic battle music” gives a model nothing to voice. “Staccato low string ostinato, brass ensemble stabs, taiko drum hits on the downbeat” names each part and how it is played, and the render comes back as an arrangement. Naming the parts makes the biggest difference between a first take you keep and one you re-roll.",
  },
  {
    icon: GaugeIcon,
    heading: "Set the tempo in BPM",
    body: "A BPM number moves the output further than “fast”, “driving” and “intense” together, because the model has nothing to interpret. Set it whenever rhythm matters (165 for a racing cue, 68 for a slow blues) and use adjectives for timbre.",
  },
  {
    icon: MicVocalIcon,
    heading: "Keep lyrics short enough to fit the render",
    body: "ACE-Step sings the lyrics block verbatim, and a 20-second render has room for a handful of lines. Give it a full verse and it rushes the syllables or silently drops the tail. Use two or four short repeated lines, tagged [verse] or [chorus]. Put the voice description in the prompt: the lyrics field is read only as words to sing.",
  },
];

/* ------------------------------------------------------------ primitives */

function Section({
  id,
  title,
  lede,
  className,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-section={id} className={cn("scroll-mt-20 pt-12", className)}>
      <h2
        id={id}
        className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl"
      >
        {title}
      </h2>
      {lede && (
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{lede}</p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function CoverCard({ track }: { track: MusicTrack }) {
  return (
    <Link
      to={`/music/${track.slug}`}
      className="group focus-visible:ring-ring/50 min-w-0 rounded-xl outline-none focus-visible:ring-3"
    >
      <div className="bg-muted relative aspect-square overflow-hidden rounded-xl">
        <MusicCover
          track={track}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          fallbackTextClassName="text-3xl"
        />
      </div>
      <p className="group-hover:text-primary mt-2 truncate text-sm font-medium underline-offset-4 group-hover:underline">
        {track.title}
      </p>
      {/* Scene beats genre on a cover: "Corridos tumbados" is what someone
          would search for, where the prompt's own word for it is the broader
          "Regional Mexican". Falls back for every track written before
          `scene` existed. */}
      <p className="text-muted-foreground truncate text-xs">{track.scene ?? track.genre}</p>
    </Link>
  );
}

/**
 * One signed act on the label roster.
 *
 * Not a link — an act has no page of its own, and a card that navigated to an
 * empty template would be the doorway-page failure the /sfx plan exists to
 * avoid. What it has instead is audio: a signature track rendered from the
 * act's persona string, played in place, plus the persona itself to copy.
 *
 * The cover falls back to an initial tile if the image is missing, so an art
 * pipeline hiccup can never ship a broken square.
 */
function ArtistCard({
  artist,
  catalog,
  meta,
  audioFailed,
}: {
  artist: MusicArtist;
  catalog: string;
  meta?: MusicTrackMeta;
  audioFailed: boolean;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  return (
    <li className="min-w-0">
      <div className="bg-muted relative aspect-square overflow-hidden rounded-xl">
        {coverFailed ? (
          <div
            aria-hidden="true"
            className="from-primary/25 via-muted to-accent flex size-full items-center justify-center bg-gradient-to-br"
          >
            <span className="font-heading text-muted-foreground text-4xl font-semibold">
              {artist.name.slice(0, 1)}
            </span>
          </div>
        ) : (
          <img
            src={assetUrl(artist.cover)}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
            className="size-full object-cover"
          />
        )}
        <span className="absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
          {catalog}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium">{artist.name}</p>
      <p className="text-muted-foreground truncate text-xs">{artist.genre}</p>

      {/* The signature track. The clock is hidden — at five cards per row the
          waveform is the scrubber and the clock would eat half its width. */}
      <div className="mt-2">
        {meta ? (
          <WaveformPlayer
            compact
            sound={artistToSound(artist, meta)}
            className="[&>span:last-child]:hidden"
          />
        ) : audioFailed ? null : (
          <Skeleton className="h-8 w-full rounded-lg" />
        )}
      </div>

      <div className="mt-2 flex items-start justify-between gap-1">
        <p className="text-muted-foreground/80 line-clamp-2 min-w-0 font-mono text-[11px] leading-relaxed">
          {artist.sound}
        </p>
        <CopyButton
          value={artist.sound}
          label={`Copy the ${artist.name} persona prompt`}
          className="-mt-0.5 shrink-0"
        />
      </div>
    </li>
  );
}

/**
 * One row in a track list.
 *
 * The whole row is a link to the track's page — there is no player here, so
 * there is nothing else a click could reasonably mean, and a row that plays
 * in place would leave the reader on an index while the page that explains
 * what they are hearing sits one click away, unvisited.
 */
function TrackRow({
  track,
  index,
  meta,
}: {
  track: MusicTrack;
  index: number;
  meta?: MusicTrackMeta;
}) {
  return (
    <li id={`track-${track.slug}`} className="scroll-mt-24">
      <Link
        to={`/music/${track.slug}`}
        className="hover:bg-accent/40 focus-visible:ring-ring/50 group/row block rounded-xl px-2 py-3 transition-colors outline-none focus-visible:ring-3"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-5 shrink-0 text-right font-mono text-xs tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <MusicCover
            track={track}
            className="bg-muted size-10 shrink-0 rounded-md object-cover"
            fallbackTextClassName="text-sm"
          />
          <div className="min-w-0 flex-1">
            <p className="group-hover/row:text-primary truncate text-sm font-medium underline-offset-4 group-hover/row:underline">
              {track.title}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {track.genre} · {MUSIC_MODEL_NAMES[track.model]}
            </p>
          </div>
          {track.lyrics && (
            <MicVocalIcon
              className="text-muted-foreground/70 size-3.5 shrink-0"
              aria-label="Sung"
            />
          )}
          <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
            {meta ? formatDuration(meta.durationS) : "—"}
          </span>
        </div>
      </Link>

      {/* Outside the anchor: a copy button nested in a link is a click target
          inside a click target, and the prompt is selectable text. */}
      <div className="mt-1 flex items-start justify-between gap-2 pr-2 pl-10">
        <p className="text-muted-foreground min-w-0 font-mono text-xs leading-relaxed">
          {track.prompt}
        </p>
        <CopyButton value={track.prompt} label="Copy prompt" className="-mt-1 shrink-0" />
      </div>
    </li>
  );
}

function TrackList({
  id,
  title,
  lede,
  tracks,
  manifest,
}: {
  id: string;
  title: string;
  lede: string;
  tracks: MusicTrack[];
  manifest: MusicManifest | null;
}) {
  return (
    <Section id={id} title={title} lede={lede} className="min-w-0">
      <ul className="divide-border/60 -mx-2 divide-y">
        {tracks.map((track, i) => (
          <TrackRow key={track.slug} track={track} index={i} meta={manifest?.[track.slug]} />
        ))}
      </ul>
    </Section>
  );
}

/* ---------------------------------------------------------------- page */

export function MusicHubPage() {
  const { manifest } = useMusicManifest();
  const { manifest: artistManifest, failed: artistsFailed } = useArtistManifest();
  const featured = trackBySlug(FEATURED_SLUG);
  const recommended = RECOMMENDED_SLUGS.map(trackBySlug).filter((t): t is MusicTrack =>
    Boolean(t),
  );
  const trending = trendingTracks();
  const instrumental = tracksIn("instrumental");
  const vocal = tracksIn("vocal");

  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title="AI music generated locally | Konchi"
        description="Thirty-six tracks generated on one desktop GPU, each with the exact prompt that made it: amapiano, drill, hyperpop, corridos, garage and more. Instrumental and sung, from open-weight models, with no account and no per-track billing."
        path="/music"
        jsonLd={[
          faqJsonLd(FAQS),
          breadcrumbJsonLd([{ name: "Music", path: "/music" }]),
          {
            "@context": "https://schema.org",
            "@type": "MusicPlaylist",
            name: "Generated locally with Konchi",
            numTracks: MUSIC_TRACKS.length,
            track: MUSIC_TRACKS.map((t) => ({
              "@type": "MusicRecording",
              name: t.title,
              genre: t.genre,
              audio: { "@type": "AudioObject", encodingFormat: "audio/mpeg" },
            })),
          },
        ]}
      />


      <main className="mx-auto w-full max-w-7xl px-4 pt-8 pb-20">
        <section className="relative isolate overflow-hidden rounded-3xl">
          <img
            src={assetUrl("/music/covers/hero-banner.webp")}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/40"
            aria-hidden="true"
          />
          <div className="relative px-6 py-12 sm:px-10 sm:py-16">
            <Badge
              variant="outline"
              className="border-white/25 bg-white/10 text-[11px] font-medium tracking-wider text-white/90 uppercase backdrop-blur"
            >
              Generated locally
            </Badge>
            <h1 className="font-heading mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
              Music you generate on your own machine
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
              Tracks rendered on a single desktop GPU by open-weight models, each with the
              exact prompt behind it to copy, edit and re-render. No account, no API key, no
              per-track billing, and nothing leaves your machine.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {featured && (
                <Button className="rounded-full px-6" asChild>
                  <Link to={`/music/${featured.slug}`}>Play {featured.title}</Link>
                </Button>
              )}
              <Button variant="secondary" className="rounded-full px-6" asChild>
                <MarketingLink href={GENERATOR_HREF}>Generate your own</MarketingLink>
              </Button>
            </div>
          </div>
        </section>

        {/* How a track is made, before the catalogue of finished ones. A
            reader who scrolls straight into cover art learns what came out
            but nothing about what it took, and the division this section is
            built on — one model that cannot sing, one that is conditioned on
            lyrics — is the fact that explains the rest of the page. */}
        <RevealMusicFlow />

        <Section
          id="featured"
          title="Featured"
          lede="A cross-section of the catalogue, from synthwave to orchestral hybrid to sung power pop, all rendered on one desktop GPU."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {recommended.map((track) => (
              <CoverCard key={track.slug} track={track} />
            ))}
          </div>
        </Section>

        {/* Popular now. The rest of the page argues the two models against
            each other; this section argues something narrower — that a
            twenty-second local render can hold a genre a listener already
            recognises. Which is why it is a cover grid rather than a track
            list: the point is breadth, and the prompt that made each one is
            one click away on the track page. */}
        <Section
          id="trending"
          title="Popular now"
          lede={`${trending.length} contemporary scenes, from amapiano and melodic drill to corridos tumbados, hyperpop and UK garage. Same two models, twenty-second renders and one GPU as the rest of the page.`}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {trending.map((track) => (
              <CoverCard key={track.slug} track={track} />
            ))}
          </div>
          <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-relaxed">
            The genre list is a snapshot of current scenes. None of these prompts names an
            artist or a record. They name instruments, rhythms and production techniques,
            and that is what the models respond to.
          </p>
        </Section>

        <div className="grid gap-x-10 lg:grid-cols-2">
          <TrackList
            id="instrumental"
            title="Instrumental"
            lede={`${instrumental.length} tracks from Stable Audio 3.0 Small Music: loops and cues built to sit under gameplay, dialogue and film.`}
            tracks={instrumental}
            manifest={manifest}
          />
          <TrackList
            id="vocal"
            title="Sung with lyrics"
            lede={`${vocal.length} tracks from ACE-Step, the lyrics-conditioned model: hand it words and it sings them. Every track page shows the exact lyrics behind the take.`}
            tracks={vocal}
            manifest={manifest}
          />
        </div>

        {/* The label. A mock roster with a real point: an artist identity,
            to a generator, is a prompt held constant — so every signed act is
            a persona string, and its signature track was rendered from
            exactly that string. Framed and badged as fictional throughout. */}
        <section aria-labelledby="artists" data-section="artists" className="scroll-mt-20 pt-12">
          <div className="border-border/60 from-card/80 to-card/30 rounded-3xl border bg-gradient-to-b p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl">
                <Disc3Icon className="size-6" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2
                  id="artists"
                  className="font-heading text-xl font-semibold tracking-tight sm:text-2xl"
                >
                  {LABEL.name}
                </h2>
                <p className="text-muted-foreground text-sm">{LABEL.tagline}</p>
              </div>
              <Badge
                variant="outline"
                className="ml-auto shrink-0 text-[11px] font-medium tracking-wider uppercase"
              >
                Fictional roster
              </Badge>
            </div>

            <p className="text-muted-foreground mt-5 max-w-2xl text-sm leading-relaxed">
              Twenty fictional acts, each with a house style. To a generative model an artist
              identity is a vocabulary held constant, so every act on this roster is a persona
              string, and its signature track was rendered from that string. Press play to
              hear the act. Copy the persona and append your own brief to render in its
              style.
            </p>

            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
              {MUSIC_ARTISTS.map((artist, i) => (
                <ArtistCard
                  key={artist.slug}
                  artist={artist}
                  catalog={catalogNumber(i)}
                  meta={artistManifest?.[artist.slug]}
                  audioFailed={artistsFailed}
                />
              ))}
            </ul>
          </div>
        </section>

        <Section
          id="craft"
          title="How to prompt for music"
          lede="Three rules with the largest effect on the output."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {CRAFT.map(({ icon: Icon, heading, body }) => (
              <div key={heading} className="border-border/60 rounded-xl border p-4">
                <Icon className="text-primary size-4" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold tracking-tight">{heading}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="why"
          title="Why generate music locally"
          lede="Rendering on your own GPU needs no account, API key, upload or per-track billing."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: WifiOffIcon,
                title: "Offline once the weights are downloaded",
                body: "Both models run through audio.cpp, a native binary, from quantised GGUF files on your disk. One SQLite file and one folder of WAVs under ~/.konchi. Nothing is uploaded.",
              },
              {
                icon: BotIcon,
                title: "An agent can drive it",
                body: "Konchi runs an MCP server. An agent calls konchi.generate with a prompt and a lyrics block and gets back an absolute path to a WAV. This page was produced through the same HTTP API.",
              },
              {
                icon: ScaleIcon,
                title: "Licences stated before you download",
                body: "Every track names its model, and every model's terms are on this page. No per-track billing, and Konchi itself is MIT.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-border/60 rounded-xl border p-4">
                <Icon className="text-primary size-4" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold tracking-tight">{title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="licensing"
          title="Licensing, in full"
          lede="Every track names the model that made it. These are both models’ terms, in full."
        >
          <ul className="space-y-3">
            {(Object.keys(MUSIC_MODEL_LICENSES) as (keyof typeof MUSIC_MODEL_LICENSES)[]).map(
              (id) => (
                <li key={id} className="border-border/60 rounded-xl border p-4">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-sm font-semibold tracking-tight">
                      {MUSIC_MODEL_NAMES[id]}
                    </h3>
                    <span className="text-muted-foreground font-mono text-xs">{id}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    <span className="text-foreground">{MUSIC_MODEL_LICENSES[id].name}</span>:{" "}
                    {MUSIC_MODEL_LICENSES[id].note}
                  </p>
                </li>
              ),
            )}
          </ul>
        </Section>

        <Section id="faq" title="Questions">
          <dl className="divide-border/60 divide-y">
            {FAQS.map((faq) => (
              <div key={faq.question} className="py-4 first:pt-0 last:pb-0">
                <dt className="text-sm font-semibold tracking-tight">{faq.question}</dt>
                <dd className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          id="related"
          title="Related collections"
          lede="More game soundtracks, and the rest of the catalogue."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { to: "/sfx/8bit-music", label: "8-bit background music" },
              { to: "/sfx/chiptune-music", label: "Chiptune music" },
              { to: "/sfx", label: "All sound effect collections" },
              { to: MODELS_HUB_HREF, label: "The models Konchi runs" },
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="border-border/60 hover:border-primary/50 group flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm transition-colors"
              >
                <span className="group-hover:text-primary underline-offset-4 group-hover:underline">
                  {link.label}
                </span>
                <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
              </Link>
            ))}
          </div>
        </Section>

        <footer className="border-border/60 text-muted-foreground mt-12 border-t pt-6 text-xs">
          <p>
            Konchi Records is a fictional label: every act on the roster is a prompt
            persona, every cover on this page is generated illustration, and no real artist,
            release or record is depicted. The audio was rendered locally by the models
            named above and encoded to MP3 for the web; each file downloads in full.{" "}
            <a
              href={REPO_URL}
              className="hover:text-foreground underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              Konchi on GitHub
            </a>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
