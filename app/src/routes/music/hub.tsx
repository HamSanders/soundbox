/**
 * `/music` — the music landing page.
 *
 * Laid out like a streaming app: a rail of sections on the left, a hero with
 * the featured track, shelves of covers, numbered track tables, and a player
 * bar pinned to the bottom. Anything on the page plays in that bar without
 * leaving it, while every title still links to `/music/:slug`, the page that
 * carries the script and the render spec and the one a search result should
 * land on.
 *
 * What stays on the rows is the prompt. It is the only thing on this page a
 * competitor's grid of clips does not have, and it belongs in the markup of
 * the page that lists them all, not only on the pages behind them.
 *
 * Content lives in `@/content/music/tracks.ts`; this file decides only how it
 * is rendered. Like the `/sfx` pages it renders outside the app shell and must
 * keep working with no backend behind it — the static site build has none.
 */

import { createContext, useContext } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BotIcon,
  Disc3Icon,
  FlameIcon,
  ListMusicIcon,
  MicVocalIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  ScaleIcon,
  SparklesIcon,
  WifiOffIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/docs-primitives";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead, breadcrumbJsonLd, faqJsonLd } from "@/components/seo-head";
import { MusicCover } from "@/components/music-cover";
import { RevealMusicFlow } from "@/components/reveal-music-flow";
import {
  SiteDock,
  SiteShelf,
  SiteShelfTile,
  SiteTrackList,
  SiteTrackRow,
  useSiteAudio,
} from "@/components/site/site-tracks";
import type { SiteAudio, SiteTrack } from "@/components/site/site-tracks";
import { getModelByCatalogId } from "@/content/models/models";
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
import {
  artistAudioUrl,
  trackAudioUrl,
  useArtistManifest,
  useMusicManifest,
} from "@/lib/music-track";
import type { MusicManifest, MusicTrackMeta } from "@/lib/music-track";
import { formatDuration } from "@/lib/format";
import {
  GENERATOR_HREF,
  MODELS_HUB_HREF,
  REPO_URL,
} from "@/lib/marketing-links";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/asset-url";

const FAQS = [
  {
    question: "Can I use this music in a commercial game or video?",
    answer:
      "It depends on which model rendered the track; every row names it. The instrumentals come from Stable Audio 3.0 Small Music, under the Stability AI Community License: free for commercial use below USD $1M annual revenue, Enterprise licence required above it. The sung tracks come from ACE-Step 1.5, whose LICENSE file is MIT: commercial use is permitted with no threshold. Mirli itself is MIT and imposes no terms on what you generate.",
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
      "Yes. Mirli exposes an MCP server, so a coding agent can call soundbox.generate with a prompt and a lyrics block and get back an absolute path to a WAV it can drop into a project. Every track on this page was produced through the HTTP API that server is built on.",
  },
];

const CRAFT = [
  {
    icon: MusicIcon,
    heading: "Name the instruments and how they are played",
    body: "“Epic battle music” gives a model nothing to voice. “Staccato low string ostinato, brass ensemble stabs, taiko drum hits on the downbeat” names each part and how it is played, and the render comes back as an arrangement. Naming the parts makes the biggest difference between a first take you keep and one you re-roll.",
  },
  {
    icon: SparklesIcon,
    heading: "Set the tempo in BPM",
    body: "A BPM number moves the output further than “fast”, “driving” and “intense” together, because the model has nothing to interpret. Set it whenever rhythm matters (165 for a racing cue, 68 for a slow blues) and use adjectives for timbre.",
  },
  {
    icon: MicVocalIcon,
    heading: "Keep lyrics short enough to fit the render",
    body: "ACE-Step sings the lyrics block verbatim, and a 20-second render has room for a handful of lines. Give it a full verse and it rushes the syllables or silently drops the tail. Use two or four short repeated lines, tagged [verse] or [chorus]. Put the voice description in the prompt: the lyrics field is read only as words to sing.",
  },
];

/** The left rail: where a listener goes, then where a reader goes. */
const RAIL = [
  {
    heading: "Listen",
    links: [
      { href: "#featured", label: "Featured", icon: SparklesIcon },
      { href: "#trending", label: "Popular now", icon: FlameIcon },
      { href: "#instrumental", label: "Instrumental", icon: MusicIcon },
      { href: "#vocal", label: "Sung with lyrics", icon: MicVocalIcon },
      { href: "#artists", label: LABEL.name, icon: Disc3Icon },
    ],
  },
  {
    heading: "Learn",
    links: [
      {
        href: "#music-flow",
        label: "How a track is made",
        icon: ListMusicIcon,
      },
      { href: "#craft", label: "How to prompt", icon: BookOpenIcon },
      { href: "#why", label: "Why local", icon: WifiOffIcon },
      { href: "#licensing", label: "Licensing", icon: ScaleIcon },
      { href: "#faq", label: "Questions", icon: BotIcon },
    ],
  },
];

const STYLES = `
@keyframes mh-eq { 0%,100% { transform: scaleY(.3) } 50% { transform: scaleY(1) } }
.mh-eq > span { transform-origin: bottom; transform: scaleY(.6) }
@media (prefers-reduced-motion: no-preference) {
  .mh-eq > span { animation: mh-eq .9s ease-in-out infinite }
  .mh-eq > span:nth-child(2) { animation-delay: -.3s }
  .mh-eq > span:nth-child(3) { animation-delay: -.6s }
}
.mh-shelf { scrollbar-width: none }
.mh-shelf::-webkit-scrollbar { display: none }
`;

/* ---------------------------------------------------------------- player */

/** Anything the dock can play: a catalogue track or a roster act's signature. */
interface Playable extends SiteTrack {
  prompt: string;
}

const PlayerContext = createContext<SiteAudio | null>(null);

function usePlayer(): SiteAudio {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("usePlayer outside the music page");
  return player;
}
/** The round play button. The one round thing on a square-cut page. */
function PlayButton({
  id,
  title,
  className,
  size = "md",
}: {
  id: string;
  title: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const { current, playing, toggle } = usePlayer();
  const active = current?.id === id && playing;
  const Icon = active ? PauseIcon : PlayIcon;
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-label={`${active ? "Pause" : "Play"} ${title}`}
      className={cn(
        "bg-foreground text-background focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-3 active:scale-95",
        size === "sm" && "size-8",
        size === "md" && "size-11",
        size === "lg" && "size-14",
        className,
      )}
    >
      <Icon
        className={cn(
          "fill-current",
          size === "lg" ? "size-6" : "size-4",
          !active && "ml-0.5",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

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
    <section
      aria-labelledby={id}
      data-section={id}
      className={cn("scroll-mt-20 pt-14", className)}
    >
      <h2
        id={id}
        className="font-display text-3xl leading-none font-extrabold text-balance uppercase sm:text-4xl"
      >
        {title}
      </h2>
      {lede && (
        <p className="text-muted-foreground mt-2.5 max-w-2xl text-sm leading-relaxed">
          {lede}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}
/** A cover on a shelf, its title set on the tile: press play to hear it, the
 *  tile to read about it. */
function CoverCard({ track }: { track: MusicTrack }) {
  const { current } = usePlayer();
  const id = `music-${track.slug}`;
  const isCurrent = current?.id === id;
  return (
    <SiteShelfTile
      name={track.title}
      // Scene beats genre on a cover: "Corridos tumbados" is what someone
      // would search for. Falls back for tracks written before `scene`.
      sub={track.scene ?? track.genre}
      to={`/music/${track.slug}`}
      art={
        <MusicCover track={track} className="size-full object-cover" fallbackTextClassName="text-3xl" />
      }
      overlay={
        <PlayButton
          id={id}
          title={track.title}
          size="sm"
          className={cn(
            "transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            isCurrent ? "opacity-100" : "opacity-0",
          )}
        />
      }
    />
  );
}

/** A row of square tiles that scrolls sideways, as the app's shelves. */
function Shelf({ tracks }: { tracks: MusicTrack[] }) {
  return (
    <SiteShelf>
      {tracks.map((track) => (
        <CoverCard key={track.slug} track={track} />
      ))}
    </SiteShelf>
  );
}

/**
 * One signed act on the label roster.
 *
 * Not a link — an act has no page of its own, and a card that navigated to an
 * empty template would be the doorway-page failure the /sfx plan exists to
 * avoid. What it has instead is audio: a signature track rendered from the
 * act's persona string, played in the bar, plus the persona itself to copy.
 *
 * The cover falls back to an initial tile if the image is missing, so an art
 * pipeline hiccup can never ship a broken circle.
 */
function ArtistCard({
  artist,
  catalog,
  playable,
}: {
  artist: MusicArtist;
  catalog: string;
  playable: boolean;
}) {
  const { current } = usePlayer();
  const id = `artist-${artist.slug}`;
  const isCurrent = current?.id === id;
  return (
    <li className="group/card hover:bg-card min-w-0 rounded-md p-2.5 transition-colors">
      <div className="relative">
        <div className="bg-muted aspect-square overflow-hidden rounded-full shadow-lg">
          <MusicCover
            track={{ title: artist.name, cover: artist.cover }}
            className="size-full object-cover"
            fallbackTextClassName="text-4xl"
          />
        </div>
        {playable ? (
          <PlayButton
            id={id}
            title={`${artist.name}, signature track`}
            className={cn(
              "absolute right-1 bottom-1 transition-[opacity,transform] duration-200 group-hover/card:translate-y-0 group-hover/card:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100",
              isCurrent ? "opacity-100" : "translate-y-1.5 opacity-0",
            )}
          />
        ) : null}
      </div>
      <p className="mt-3 truncate text-sm font-semibold">{artist.name}</p>
      <p className="text-muted-foreground mt-0.5 truncate text-xs">
        <span className="readout">{catalog}</span> · {artist.genre}
      </p>
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
 * One row in a track table, on the app's track grid.
 *
 * The tile plays the row in the dock; the title is a link to `/music/:slug`,
 * the page that carries the script and the render spec. The prompt stays on
 * the row, in the markup: it is the one thing here a competitor's grid of
 * clips does not have.
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
  const { current, playing, toggle } = usePlayer();
  const id = `music-${track.slug}`;
  const licence = MUSIC_MODEL_LICENSES[track.model];
  const log = [track.genre, track.lyrics ? "sung" : "instrumental", licence.name].join(" · ");
  return (
    <SiteTrackRow
      id={`track-${track.slug}`}
      no={String(index + 1).padStart(2, "0")}
      tile={<MusicCover track={track} className="bg-muted size-full object-cover" fallbackTextClassName="text-sm" />}
      title={track.title}
      href={`/music/${track.slug}`}
      log={log}
      detail={
        <p className="text-muted-foreground/80 truncate font-mono text-[11px] leading-relaxed" title={track.prompt}>
          {track.prompt}
        </p>
      }
      license={getModelByCatalogId(track.model)?.license.commercial}
      model={MUSIC_MODEL_NAMES[track.model]}
      length={meta ? formatDuration(meta.durationS) : `${track.durationS}s`}
      isCurrent={current?.id === id}
      playing={playing}
      onPlay={() => toggle(id)}
      actions={<CopyButton value={track.prompt} label="Copy prompt" className="shrink-0" />}
    />
  );
}

function TrackTable({
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
      <SiteTrackList>
        {tracks.map((track, i) => (
          <TrackRow key={track.slug} track={track} index={i} meta={manifest?.[track.slug]} />
        ))}
      </SiteTrackList>
    </Section>
  );
}

/** The prompt of whatever is playing, beside the dock's timeline. */
function DockPrompt({ queue }: { queue: Playable[] }) {
  const { current } = usePlayer();
  const prompt = queue.find((q) => q.id === current?.id)?.prompt;
  if (!prompt) return null;
  return (
    <>
      <p className="text-muted-foreground line-clamp-2 min-w-0 text-right font-mono text-[11px] leading-snug" title={prompt}>
        {prompt}
      </p>
      <CopyButton value={prompt} label="Copy this track's prompt" className="shrink-0" />
    </>
  );
}
/* ---------------------------------------------------------------- page */

export function MusicHubPage() {
  const { manifest } = useMusicManifest();
  const { manifest: artistManifest, failed: artistsFailed } =
    useArtistManifest();
  const featured = trackBySlug(FEATURED_SLUG);
  const recommended = RECOMMENDED_SLUGS.map(trackBySlug).filter(
    (t): t is MusicTrack => Boolean(t),
  );
  const trending = trendingTracks();
  const instrumental = tracksIn("instrumental");
  const vocal = tracksIn("vocal");

  // Everything the bar can play, in the order the page lists it.
  const queue: Playable[] = [
    ...[...instrumental, ...vocal].map((track) => ({
      id: `music-${track.slug}`,
      title: track.title,
      sub: `${track.scene ?? track.genre} · ${MUSIC_MODEL_NAMES[track.model]}`,
      tile: <MusicCover track={track} className="bg-muted size-full object-cover" fallbackTextClassName="text-base" />,
      url: trackAudioUrl(track.slug),
      prompt: track.prompt,
      href: `/music/${track.slug}`,
      durationS: manifest?.[track.slug]?.durationS,
    })),
    ...(artistsFailed
      ? []
      : MUSIC_ARTISTS.map((artist, i) => ({
          id: `artist-${artist.slug}`,
          title: artist.name,
          sub: `${LABEL.name} · ${catalogNumber(i)} · ${artist.genre}`,
          tile: (
            <MusicCover
              track={{ title: artist.name, cover: artist.cover }}
              className="bg-muted size-full object-cover"
              fallbackTextClassName="text-base"
            />
          ),
          url: artistAudioUrl(artist.slug),
          prompt: artist.sound,
          durationS: artistManifest?.[artist.slug]?.durationS,
        }))),
  ];
  const player = useSiteAudio(queue, featured && `music-${featured.slug}`);

  return (
    <PlayerContext.Provider value={player}>
      <div className="bg-background text-foreground min-h-svh">
        <SeoHead
          title="AI music generated locally | Mirli"
          description="Thirty-six tracks generated on one desktop GPU, each with the exact prompt that made it: amapiano, drill, hyperpop, corridos, garage and more. Instrumental and sung, from open-weight models, with no account and no per-track billing."
          path="/music"
          jsonLd={[
            faqJsonLd(FAQS),
            breadcrumbJsonLd([{ name: "Music", path: "/music" }]),
            {
              "@context": "https://schema.org",
              "@type": "MusicPlaylist",
              name: "Generated locally with Mirli",
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
        <style>{STYLES}</style>
        {player.element}

        <div className="mx-auto w-full max-w-[96rem] lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
          {/* ------------------------------------------------------ rail */}
          <nav
            aria-label="On this page"
            className="border-border sticky top-14 hidden h-[calc(100svh-3.5rem-72px)] flex-col gap-7 overflow-y-auto border-r px-3 py-6 lg:flex"
          >
            {RAIL.map((group) => (
              <div key={group.heading}>
                <p className="label-caps text-muted-foreground px-3">
                  {group.heading}
                </p>
                <ul className="mt-2">
                  {group.links.map(({ href, label, icon: Icon }) => (
                    <li key={href}>
                      <a
                        href={href}
                        className="text-muted-foreground hover:text-foreground hover:bg-card focus-visible:ring-ring/50 flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3"
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="bg-card mt-auto rounded-md p-4">
              <p className="text-sm font-semibold">Make your own</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Every prompt here is yours to copy, edit and render again.
              </p>
              <Button size="sm" className="mt-3 w-full" asChild>
                <MarketingLink href={GENERATOR_HREF}>
                  Open the generator
                </MarketingLink>
              </Button>
            </div>
          </nav>

          <main className="min-w-0 px-4 pt-6 pb-28 lg:px-8">
            {/* ---------------------------------------------------- hero */}
            <section className="relative isolate overflow-hidden rounded-md">
              <img
                src={assetUrl("/music/covers/hero-banner.webp")}
                alt=""
                className="absolute inset-0 -z-10 size-full object-cover"
              />
              <div
                className="bg-dusk/70 absolute inset-0 -z-10"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-6 px-5 pt-24 pb-6 sm:px-8 sm:pt-36 sm:pb-8 md:flex-row md:items-end">
                {featured ? (
                  <MusicCover
                    track={featured}
                    className="hidden size-44 shrink-0 rounded-sm object-cover shadow-2xl md:block lg:size-52"
                    fallbackTextClassName="text-5xl"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="label-caps text-white/80">
                    Generated locally · {MUSIC_TRACKS.length} tracks · 2 models
                    · 1 GPU
                  </p>
                  <h1 className="mt-3 max-w-4xl text-[clamp(2.6rem,6.4vw,5.75rem)] leading-[0.88] text-balance text-white uppercase">
                    Music you generate on your own machine
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base">
                    Tracks rendered on a single desktop GPU by open-weight
                    models, each with the exact prompt behind it to copy, edit
                    and re-render. No account, no API key, no per-track billing,
                    and nothing leaves your machine.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-dusk/70 px-5 py-4 backdrop-blur-sm sm:px-8">
                {featured ? (
                  <>
                    <PlayButton
                      id={`music-${featured.slug}`}
                      title={featured.title}
                      size="lg"
                      className="bg-white text-black"
                    />
                    <div className="min-w-0">
                      <p className="label-caps text-white/60">Featured track</p>
                      <Link
                        to={`/music/${featured.slug}`}
                        className="block truncate text-sm font-semibold text-white underline-offset-4 hover:underline"
                      >
                        {featured.title}
                      </Link>
                    </div>
                  </>
                ) : null}
                <Button variant="secondary" className="ml-auto" asChild>
                  <MarketingLink href={GENERATOR_HREF}>
                    Generate your own
                  </MarketingLink>
                </Button>
              </div>
            </section>

            <Section
              id="featured"
              title="Featured"
              lede="A cross-section of the catalogue, from synthwave to orchestral hybrid to sung power pop, all rendered on one desktop GPU."
            >
              <Shelf tracks={recommended} />
            </Section>

            {/* Popular now. The rest of the page argues the two models against
                each other; this section argues something narrower — that a
                twenty-second local render can hold a genre a listener already
                recognises. Which is why it is a shelf of covers rather than a
                track table: the point is breadth, and the prompt that made
                each one is one click away on the track page. */}
            <Section
              id="trending"
              title="Popular now"
              lede={`${trending.length} contemporary scenes, from amapiano and melodic drill to corridos tumbados, hyperpop and UK garage. Same two models, twenty-second renders and one GPU as the rest of the page.`}
            >
              <Shelf tracks={trending} />
              <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-relaxed">
                The genre list is a snapshot of current scenes. None of these
                prompts names an artist or a record. They name instruments,
                rhythms and production techniques, and that is what the models
                respond to.
              </p>
            </Section>

            <TrackTable
              id="instrumental"
              title="Instrumental"
              lede={`${instrumental.length} tracks from Stable Audio 3.0 Small Music: loops and cues built to sit under gameplay, dialogue and film.`}
              tracks={instrumental}
              manifest={manifest}
            />
            <TrackTable
              id="vocal"
              title="Sung with lyrics"
              lede={`${vocal.length} tracks from ACE-Step, the lyrics-conditioned model: hand it words and it sings them. Every track page shows the exact lyrics behind the take.`}
              tracks={vocal}
              manifest={manifest}
            />

            {/* The label. A mock roster with a real point: an artist identity,
                to a generator, is a prompt held constant — so every signed act is
                a persona string, and its signature track was rendered from
                exactly that string. Framed and badged as fictional throughout. */}
            <section
              aria-labelledby="artists"
              data-section="artists"
              className="scroll-mt-20 pt-14"
            >
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="label-caps text-muted-foreground">
                    {LABEL.tagline}
                  </p>
                  <h2
                    id="artists"
                    className="font-display mt-1 text-3xl leading-none font-extrabold uppercase sm:text-4xl"
                  >
                    {LABEL.name}
                  </h2>
                </div>
                <Badge
                  variant="outline"
                  className="label-caps ml-auto shrink-0"
                >
                  Fictional roster
                </Badge>
              </div>
              <p className="text-muted-foreground mt-2.5 max-w-2xl text-sm leading-relaxed">
                Twenty fictional acts, each with a house style. To a generative
                model an artist identity is a vocabulary held constant, so every
                act on this roster is a persona string, and its signature track
                was rendered from that string. Press play to hear the act. Copy
                the persona and append your own brief to render in its style.
              </p>
              <ul className="-mx-2.5 mt-6 grid grid-cols-2 gap-y-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {MUSIC_ARTISTS.map((artist, i) => (
                  <ArtistCard
                    key={artist.slug}
                    artist={artist}
                    catalog={catalogNumber(i)}
                    playable={!artistsFailed}
                  />
                ))}
              </ul>
            </section>

            {/* How a track is made: the division the catalogue above is built
                on — one model that cannot sing, one that is conditioned on
                lyrics — shown after the listener has heard both. */}
            <RevealMusicFlow />

            <Section
              id="craft"
              title="How to prompt for music"
              lede="Three rules with the largest effect on the output."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                {CRAFT.map(({ icon: Icon, heading, body }) => (
                  <div key={heading} className="bg-card rounded-md p-5">
                    <Icon className="text-primary size-4" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-semibold tracking-tight">
                      {heading}
                    </h3>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {body}
                    </p>
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
                    body: "Both models run through audio.cpp, a native binary, from quantised GGUF files on your disk. One SQLite file and one folder of WAVs under ~/.soundbox. Nothing is uploaded.",
                  },
                  {
                    icon: BotIcon,
                    title: "An agent can drive it",
                    body: "Mirli runs an MCP server. An agent calls soundbox.generate with a prompt and a lyrics block and gets back an absolute path to a WAV. This page was produced through the same HTTP API.",
                  },
                  {
                    icon: ScaleIcon,
                    title: "Licences stated before you download",
                    body: "Every track names its model, and every model's terms are on this page. No per-track billing, and Mirli itself is MIT.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="bg-card rounded-md p-5">
                    <Icon className="text-primary size-4" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-semibold tracking-tight">
                      {title}
                    </h3>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {body}
                    </p>
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
                {(
                  Object.keys(
                    MUSIC_MODEL_LICENSES,
                  ) as (keyof typeof MUSIC_MODEL_LICENSES)[]
                ).map((id) => (
                  <li key={id} className="bg-card rounded-md p-5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="text-sm font-semibold tracking-tight">
                        {MUSIC_MODEL_NAMES[id]}
                      </h3>
                      <span className="text-muted-foreground font-mono text-xs">
                        {id}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      <span className="text-foreground">
                        {MUSIC_MODEL_LICENSES[id].name}
                      </span>
                      : {MUSIC_MODEL_LICENSES[id].note}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section id="faq" title="Questions">
              <dl className="divide-border/60 max-w-3xl divide-y">
                {FAQS.map((faq) => (
                  <div key={faq.question} className="py-4 first:pt-0 last:pb-0">
                    <dt className="text-sm font-semibold tracking-tight">
                      {faq.question}
                    </dt>
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
                  { to: MODELS_HUB_HREF, label: "The models Mirli runs" },
                ].map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="bg-card hover:bg-accent group flex items-center justify-between gap-2 rounded-md px-4 py-3 text-sm transition-colors"
                  >
                    <span className="underline-offset-4 group-hover:underline">
                      {link.label}
                    </span>
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                ))}
              </div>
            </Section>

            <footer className="border-border/60 text-muted-foreground mt-14 border-t pt-6 text-xs">
              <p className="max-w-3xl">
                Mirli Records is a fictional label: every act on the roster
                is a prompt persona, every cover on this page is generated
                illustration, and no real artist, release or record is depicted.
                The audio was rendered locally by the models named above and
                encoded to MP3 for the web; each file downloads in full.{" "}
                <a
                  href={REPO_URL}
                  className="hover:text-foreground underline underline-offset-4"
                  target="_blank"
                  rel="noreferrer"
                >
                  Mirli on GitHub
                </a>
                .
              </p>
            </footer>
          </main>
        </div>

        <SiteDock audio={player} trailing={<DockPrompt queue={queue} />} />
      </div>
    </PlayerContext.Provider>
  );
}
