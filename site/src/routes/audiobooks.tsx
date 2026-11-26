/**
 * `/audiobooks` — the page for the audiobook side of Mirli: import, cast,
 * pronounce, render, beds, export with the ACX check, Listen, and the book
 * editor's assistant.
 *
 * Not to be confused with the app's own `/audiobooks` route
 * (`app/src/routes/audiobooks.tsx`), which is the shelf inside the running
 * app. This one is site-only, like `/mcp` and `/press`, and the site's
 * `SiteHeader` wraps it.
 *
 * The same two rules as `voices.tsx` and `studio-marketing.tsx`:
 *
 * 1. **No query hooks.** Prerendered, with no backend behind it.
 * 2. **No overselling.** Every claim traces to the code or the user guide
 *    written from it: the importers in `server/src/audiobook/import/`
 *    (formats in `index.ts`, languages in `lang.ts`, DRM in `drm.ts`), the
 *    classics in `server/src/audiobook/classics/`, the render checks in
 *    `render-qc.ts`, the export formats and ACX numbers in `export.ts` and
 *    the export dialog, ducking in `beds.ts`, the player limits in
 *    `app/src/lib/listen-player-store.ts`, publishing in
 *    `server/src/audiobook/publish/`, the assistant's card in
 *    `app/src/components/agent-proposal.tsx`, the toasts in
 *    `app/src/lib/undo.ts` and the trash in `server/src/trash.ts`.
 *    `docs/AUDIOBOOKS.md` says the same things at length.
 *
 * The screenshots are real captures of the app on its mock backend, taken by
 * `scripts/capture-media.mjs` (the `app-audiobook-*`, `app-listen-*` and
 * `app-trash` rows). To change one, change the script, not the image.
 *
 * ACX is named because its published numbers are what the check measures.
 * The page also says, once, that passing them is not acceptance and that
 * ACX's narration policy applies: a reader deciding whether to make a book
 * for Audible needs that before anything else.
 */

import { Link } from "react-router-dom";
import { BookOpenIcon, DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeoHead, softwareAppJsonLd } from "@/components/seo-head";
import { assetUrl } from "@/lib/asset-url";
import { GENERATOR_HREF } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

/**
 * The bundled public-domain library. Counted from
 * `server/src/audiobook/classics/classics.json` (1 MB, so not imported here);
 * update this if `scripts/build-classics.mjs` changes the list.
 */
const CLASSICS = 42;

/* ---------------------------------------------------------- primitives */

function Section({
  id,
  eyebrow,
  title,
  lede,
  className,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("border-border/60 scroll-mt-20 border-t px-4 py-16 sm:py-20", className)}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="max-w-2xl">
          <p className="label-caps text-primary">{eyebrow}</p>
          <h2
            id={id}
            className="font-heading mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            {title}
          </h2>
          {lede && <p className="text-muted-foreground mt-3 leading-relaxed">{lede}</p>}
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

/**
 * One capture from `site/public/product/`. Every audiobook shot is 1440x900
 * CSS pixels at 2x. Lazy, except the one in the hero.
 */
function Shot({
  src,
  alt,
  caption,
  eager = false,
  className,
}: {
  src: string;
  alt: string;
  caption?: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <figure className={cn("min-w-0", className)}>
      <img
        src={assetUrl(src)}
        alt={alt}
        width={1440}
        height={900}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="ring-border/70 aspect-[16/10] w-full rounded-xl object-cover object-top shadow-lg ring-1"
      />
      {caption && (
        <figcaption className="text-muted-foreground mt-3 text-xs leading-relaxed">{caption}</figcaption>
      )}
    </figure>
  );
}

/** Text beside a screenshot: the text first on a phone, side by side from lg. */
function Split({
  children,
  shot,
  reverse = false,
}: {
  children: React.ReactNode;
  shot: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-8 lg:items-start lg:gap-10",
        // The screenshot always gets the wider column, whichever side it is on.
        reverse
          ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
          : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]",
      )}
    >
      <div
        className={cn(
          "text-muted-foreground space-y-4 text-sm leading-relaxed",
          reverse && "lg:order-2",
        )}
      >
        {children}
      </div>
      <div className={cn(reverse && "lg:order-1")}>{shot}</div>
    </div>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground font-medium">{children}</span>;
}

/* ---------------------------------------------------------------- hero */

function Hero() {
  return (
    <section aria-labelledby="audiobooks-hero-heading" className="relative overflow-hidden px-4">
      <div
        aria-hidden="true"
        className="bg-primary/12 pointer-events-none absolute -top-48 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-5xl py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-muted-foreground ring-border bg-card inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1">
            <BookOpenIcon className="size-3.5" aria-hidden="true" />
            Audiobooks · Listen
          </span>
          <h1
            id="audiobooks-hero-heading"
            className="font-heading mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
          >
            Turn a manuscript into an audiobook
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            Import a book, give the narrator and each character a voice, fix the names the
            model gets wrong, lay music and ambience under a chapter, check it against
            ACX&apos;s published numbers and export MP3, M4B, FLAC or WAV. Then listen to it
            with the text highlighted as it is read.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <Button size="lg" asChild>
              <Link to={GENERATOR_HREF}>
                <DownloadIcon aria-hidden="true" />
                Download Mirli
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/docs/audiobooks">Read the audiobook guide</Link>
            </Button>
          </div>
        </div>

        <Shot
          eager
          className="mx-auto mt-12 max-w-5xl"
          src="/product/app-audiobook-cast.webp"
          alt="The audiobook editor: a chapter list on the left, the chapter's paragraphs in the middle, each tagged with who reads it (Narrator, Tomas, Mara) and whether it is voiced, unvoiced, locked or stale, the Cast tab on the right with a voice and its model for the narrator and each character, and the chapter's timeline along the bottom."
          caption="The book editor: chapters, paragraphs with who reads each one and its status, the cast, and the chapter's timeline."
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- sections */

function Import() {
  return (
    <Section
      id="import"
      eyebrow="Import"
      title="Start from a file, a web page or a classic"
      lede="Mirli reads EPUB, PDF, Word (DOCX), OpenDocument (ODT), RTF, FB2, plain text, Markdown and HTML files, a web page by its address, or text you paste."
    >
      <div className="text-muted-foreground grid gap-6 text-sm leading-relaxed md:grid-cols-2">
        <div className="space-y-4">
          <p>
            Chapters come from the file&apos;s structure. Copyright pages, dedications,
            tables of contents and similar sections are marked as front or back matter, and
            each section has its own include switch, so a copyright page can stay in the book
            without being read aloud. Title, author, cover and other details are read from the
            file where it has them.
          </p>
          <p>
            A review screen shows what was found before anything is created: rename, change
            the kind of, merge, split or leave out sections, check the details and the cover,
            and pick a narrator. Chapter detection also works for books in German, French,
            Spanish, Italian, Portuguese, Dutch, Polish, Russian, Chinese and Japanese.
            DRM-protected EPUB and Kindle files are refused, with the reason.
          </p>
        </div>
        <div className="border-border/60 bg-card/80 rounded-xl border p-5">
          <h3 className="font-heading text-foreground text-sm font-semibold">
            {CLASSICS} public-domain classics ship with the app
          </h3>
          <p className="mt-2">
            Short stories by O. Henry, Poe, Chekhov, Saki and Charlotte Perkins Gilman, fairy
            tales from Wilde and the Brothers Grimm, Aesop&apos;s fables, <em>A Christmas
            Carol</em>, <em>Dr. Jekyll and Mr. Hyde</em> and <em>Alice&apos;s Adventures in
            Wonderland</em>, and poems by Keats, Shelley, Blake, Rossetti, Dickinson and
            Whitman. They are bundled, so they work offline.
          </p>
          <p className="mt-2">
            The texts are Standard Ebooks and Project Gutenberg editions. They are public
            domain in the US; other countries have longer copyright terms, so check yours
            before publishing a recording.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Cast() {
  return (
    <Section
      id="cast"
      eyebrow="Cast"
      title="A narrator, and a voice for each character"
      lede="One narrator for the whole book, or a narrator plus a voice per character."
    >
      {/* No screenshot here: the hero above is this same editor on its Cast tab. */}
      <div className="text-muted-foreground grid gap-6 text-sm leading-relaxed md:grid-cols-3">
        <p>
          <Strong>Detect</Strong> finds who speaks each quoted line and can split dialogue
          into its own paragraphs. It uses the prompt assistant when that is on, and
          &ldquo;said Mara&rdquo; style tags when it is not. It then suggests a different
          voice for each character from the voices you have saved, and you can hear any voice
          on that character&apos;s own lines before you choose.
        </p>
        <p>
          Change a character&apos;s voice and all of their lines follow. Any paragraph can be
          given to another character, and has the delivery controls its model offers.
        </p>
        <p>
          Each voice reads on the model it was made on, shown beside it in the picker, because
          a cloned voice read on a different model stops sounding like itself. Any
          text-to-speech model Mirli runs can read a book. The{" "}
          <Link to="/voices" className="text-foreground underline underline-offset-4">
            voices page
          </Link>{" "}
          covers making and cloning them.
        </p>
      </div>
    </Section>
  );
}

function Pronounce() {
  return (
    <Section
      id="pronounce"
      eyebrow="Pronounce"
      title="Teach it the names it gets wrong"
      lede="A pronunciation dictionary for each book, and one shared by every book."
    >
      <Split
        reverse
        shot={
          <Shot
            src="/product/app-audiobook-pronounce.webp"
            alt="The Pronounce tab: a rule that reads Marlow as MAR-low, set as an alias, with a play button to hear it in context, a form to add another rule, and buttons to suggest terms, import a .pls or .txt file and export PLS or TXT."
          />
        }
      >
        <p>
          An <Strong>alias</Strong> respells a word (Marlow as &ldquo;MAR-low&rdquo;) and
          works on every model. <Strong>IPA</Strong> and <Strong>CMU</Strong> rules give
          phonemes to models that accept them, and fall back to a plain respelling on the ones
          that don&apos;t. Rules apply top to bottom and the first match wins; each can be
          case-sensitive or whole-word.
        </p>
        <p>
          Mirli suggests names and unusual words from the text, and plays a rule in its
          sentence so you can hear it work. Rules import from and export to PLS and text
          files. Paragraphs a new rule changes are marked <Strong>stale</Strong>, so you
          re-voice only those.
        </p>
      </Split>
    </Section>
  );
}

function Render() {
  const items: { title: string; body: string }[] = [
    {
      title: "Paragraph by paragraph",
      body: "Voice the whole book, a chapter or the paragraphs you select. Every paragraph shows whether it is unvoiced, voiced, stale (its text, voice or pronunciation changed since) or locked.",
    },
    {
      title: "An estimate first",
      body: "Before a run starts you see how long the audio will be and how long the render will take. A run can be paused, resumed or cancelled, and picks up after a restart.",
    },
    {
      title: "Takes and locks",
      body: "Every generation of a paragraph is kept as a take you can play, put back or delete. Lock a paragraph you are happy with and nothing re-voices it.",
    },
    {
      title: "Checked as it goes",
      body: "A paragraph that comes out silent, clipped or the wrong length is voiced again, up to twice, and the log says why. With a speech recognition model installed, a read with the wrong words is too.",
    },
  ];
  return (
    <Section
      id="render"
      eyebrow="Render"
      title="Voice it, and redo only what is wrong"
      lede="Pauses between paragraphs and after headings sit on the chapter's timeline rather than in the text, so they work on every model."
    >
      <ul className="border-border grid border-t border-l sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.title} className="border-border border-r border-b p-5">
            <h3 className="text-base font-semibold tracking-tight">{item.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{item.body}</p>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-6 max-w-3xl text-sm leading-relaxed">
        Each chapter is also a script on the studio&apos;s timeline, docked under the editor.
        When a paragraph is voiced to a new length, everything after it moves along; drag a
        paragraph&apos;s clip and the text reorders to match. Trims, fades, the mixer and the
        effects rack all work there, as they do in the{" "}
        <Link to="/studio" className="text-foreground underline underline-offset-4">
          studio
        </Link>
        .
      </p>
    </Section>
  );
}

function Beds() {
  return (
    <Section
      id="beds"
      eyebrow="Beds"
      title="Music, ambience and effects under the narration"
      lede="A chapter can have music or ambience playing under it, and sound effects at the paragraphs you pick."
    >
      <Split
        shot={
          <Shot
            src="/product/app-audiobook-beds.webp"
            alt="The Beds section of a chapter, after Suggest soundscape: a note that the suggestions came from keywords in the text, Accept all and Dismiss buttons, and three suggestions: an ambience bed of calm sea waves at night across paragraphs 1 to 7, a door slam at paragraph 1 and footsteps on wooden stairs at paragraph 7, each with its level and buttons to edit, accept or reject."
            caption="Suggest soundscape with the prompt assistant off: suggestions from keywords, and the panel says so."
          />
        }
      >
        <p>
          A bed comes from your library or is generated from a prompt on a music or sound
          effect model you have installed. It can loop to fill the chapter, fade in and out,
          or play as an intro or outro only. Each bed is its own track in the chapter&apos;s
          timeline.
        </p>
        <p>
          Beds <Strong>duck</Strong> under the narration: wherever the voice is speaking, the
          bed is pulled down by the depth you set, starting a moment before the voice and
          coming back up after it, with adjustable attack, release and lookahead. Short gaps
          between sentences stay ducked, so the music doesn&apos;t pump.
        </p>
        <p>
          <Strong>Suggest soundscape</Strong> reads a chapter and proposes a quiet bed for
          each scene and an effect where the text names a sound (&ldquo;the door
          slammed&rdquo;). Nothing is added until you accept a suggestion.
        </p>
      </Split>
    </Section>
  );
}

function Export() {
  return (
    <Section
      id="export"
      eyebrow="Export"
      title="Master, check against ACX, export"
      lede="MP3 at a constant bitrate, M4B with chapter markers and the cover, FLAC or WAV, as one file or one file per chapter."
    >
      <Split
        reverse
        shot={
          <Shot
            src="/product/app-audiobook-acx.webp"
            alt="The Export audiobook dialog on its ACX check tab: a table of chapters with RMS, peak, noise floor, head and tail room tone, length and a result. Two chapters pass; three have no audio yet and say what to fix."
            caption="The ACX check on a book that is half voiced: two chapters pass, three have nothing to measure yet."
          />
        }
      >
        <p>
          The <Strong>ACX</Strong> preset masters each chapter to mono, 44.1 kHz, about
          −20 dB RMS with peaks under −3 dB, with room tone at the head and tail. The check
          measures every chapter&apos;s RMS, peak, noise floor, room tone and length against
          ACX&apos;s published numbers and shows pass or fail, with what to fix. A{" "}
          <Strong>podcast</Strong> preset and <Strong>none</Strong> are there too.
        </p>
        <p>
          Per-chapter files are zipped and named the ACX way (<code className="font-mono text-xs">00_Opening Credits</code>,{" "}
          <code className="font-mono text-xs">01_…</code>). Mirli can also make opening and
          closing credits and a one-to-five-minute retail sample, and write SRT and VTT
          captions and a read-along file. MP3, M4B and FLAC need ffmpeg; the dialog says
          when it is missing.
        </p>
        <p className="border-border/60 border-l-2 pl-3">
          Passing these checks does not mean ACX will accept a book. ACX also reviews the
          audio by ear, and its narration policy applies. Read ACX&apos;s current
          requirements before you submit.
        </p>
      </Split>
    </Section>
  );
}

function Listen() {
  return (
    <Section
      id="listen"
      eyebrow="Listen"
      title="A player for the books you made"
      lede="Listen is a shelf for your audiobooks: continue listening, recently finished, every book, and a row for each genre and series."
    >
      <Split
        shot={
          <Shot
            src="/product/app-listen-player.webp"
            alt="The full-screen player for Pride and Prejudice: the cover, a progress bar and playback controls with 15 and 30 second skips, speed, sleep timer and Bookmark on the left; the chapter's text on the right with the paragraph being read highlighted and the current word marked."
          />
        }
      >
        <p>
          The player shows the text beside the audio and highlights the paragraph and the
          word being read. Tap any voiced paragraph to play from there. It has chapters,
          15 and 30 second skips, speeds from 0.25x to 4x, a sleep timer (including the end
          of the chapter), bookmarks with notes, and it remembers where you stopped.
        </p>
        <p>
          <Strong>Publish and share</Strong> checks a book against what Spotify for Authors,
          Apple Books, read-along apps and podcast feeds ask for, and exports either a
          self-contained web player that opens from disk or a podcast RSS feed with an
          episode per chapter.
        </p>
      </Split>
      <div className="mt-12">
        <Split
          reverse
          shot={
            <Shot
              src="/product/app-listen-explore.webp"
              alt="The Explore tab of Listen: filters for tag, genre, narration, language, length and order, a Top picks carousel of book covers with Pride and Prejudice in front, and collections such as Sherlock Holmes, Short listens and Something dark for tonight."
            />
          }
        >
          <h3 className="font-heading text-foreground text-base font-semibold">Explore</h3>
          <p>
            The second tab is for finding what to listen to next, among your own books and the
            bundled classics you haven&apos;t added yet: top picks, collections such as short
            listens, poems or a series in order, and rows by genre, all with filters.
          </p>
          <p>
            A classic&apos;s <Strong>+</Strong> adds it to your library without leaving the
            page. The toast that follows has <Strong>Open</Strong>, to cast and voice it, and{" "}
            <Strong>Undo</Strong>.
          </p>
        </Split>
      </div>
    </Section>
  );
}

function Assistant() {
  return (
    <Section
      id="assistant"
      eyebrow="Assistant"
      title="Say what to change, then accept it"
      lede="With the prompt assistant turned on in Settings, the book editor has an Assistant tab. Ask about the book, or say what to change."
      className="bg-muted/20"
    >
      <Split
        shot={
          <Shot
            src="/product/app-audiobook-assistant.webp"
            alt="The Assistant tab in the audiobook editor. The request reads: Make Juno the narrator and pronounce Marlow as MAR-low. The reply is a card waiting for you, with two steps (set the narrator's voice to Juno, add a pronunciation for Marlow), each with its own accept and reject buttons, and Accept all, Tweak and Reject below."
          />
        }
      >
        <p>
          &ldquo;Make Ada the narrator&rdquo;, &ldquo;pronounce Marlow as MAR-low&rdquo;,
          &ldquo;rename chapter II&rdquo;, &ldquo;put rain under this chapter&rdquo;: what it
          wants to do comes back as a card, one row per step. Reading steps run at once.
          Everything else waits for you.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <Strong>Accept</Strong> runs the steps in order and stops at the first that fails;
            each row can also be accepted or rejected on its own. Steps that make audio are
            marked, and a step that deletes is shown in red.
          </li>
          <li>
            <Strong>Reject</Strong> runs nothing. <Strong>Tweak</Strong> puts your request
            back in the box.
          </li>
          <li>
            Once run, <Strong>Undo</Strong> puts back what it can, and the card names the
            steps it can&apos;t, such as voiced audio.
          </li>
        </ul>
        <p>
          It works through the same <code className="font-mono text-xs">soundbox.*</code>{" "}
          tools an agent gets over MCP, so it can do what they do and nothing else. The prompt
          assistant is off by default; it runs a small model Mirli installs for you, or any
          OpenAI-compatible server already running on your machine.
        </p>
      </Split>
    </Section>
  );
}

const AGENT_FLOW = [
  "import_manuscript",
  "set_character_voice",
  "add_pronunciation",
  "render_audiobook",
  "add_bed",
  "master_and_export_audiobook",
];

function Agents() {
  return (
    <Section
      id="agents"
      eyebrow="For agents"
      title="An agent can build the whole book"
      lede="Every step on this page has an MCP tool, so Claude Code, Cursor or any MCP client connected to Mirli can make an audiobook end to end."
    >
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {AGENT_FLOW.map((tool, i) => (
          <li key={tool} className="flex items-center gap-2">
            <code className="bg-muted/60 ring-border rounded-md px-2 py-1 font-mono ring-1 ring-inset">
              soundbox.{tool}
            </code>
            {i < AGENT_FLOW.length - 1 && (
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground mt-6 max-w-3xl text-sm leading-relaxed">
        More tools edit the text and the chapters: edit, cast, lock, split and merge
        paragraphs, find and replace across the book, and add, rename, move or delete
        chapters. They go through the same HTTP API as the app, so they validate exactly as
        the editor does, and a book an agent builds opens in the app like any other.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to="/mcp">Connect an agent</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/docs/mcp">MCP reference</Link>
        </Button>
      </div>
    </Section>
  );
}

function UndoAndTrash() {
  return (
    <Section
      id="undo"
      eyebrow="Undo and the trash"
      title="Fewer “Are you sure?” dialogs"
      lede="Deleting no longer asks first. It happens at once, and a toast offers Undo."
    >
      <Split
        reverse
        shot={
          <Shot
            src="/product/app-trash.webp"
            alt="The Trash page: an audiobook called Field Notes, deleted just now, to be deleted for good in 30 days, with Restore and Delete forever buttons. A toast in the corner says the book was deleted with its chapters and voiced audio and offers Undo."
          />
        }
      >
        <p>
          Ctrl+Z (Cmd+Z) undoes the newest toast, and the book editor and the studio have
          their own undo for edits.
        </p>
        <p>
          Sounds, sessions and audiobooks you delete go to the <Strong>Trash</Strong>, with
          everything they hold, and stay there for 30 days before they are deleted for good.
          Restore them from there, or delete them for good sooner. A delete made by an agent
          over MCP goes to the same trash.
        </p>
      </Split>
    </Section>
  );
}

function Close() {
  return (
    <section
      aria-labelledby="audiobooks-close-heading"
      className="border-border/60 bg-muted/20 border-t px-4 py-16 sm:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="max-w-2xl">
          <p className="label-caps text-primary">Running it</p>
          <h2
            id="audiobooks-close-heading"
            className="font-heading mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            Audiobooks are part of Mirli
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            Audiobooks come with the app. To voice a book you need a
            text-to-speech model, installed in the app or reached through an endpoint you
            add. Read its licence first: it decides what you may do with the recording.
          </p>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild>
            <Link to={GENERATOR_HREF}>Download Mirli</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/docs/audiobooks">Audiobook guide</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/models">Models and licences</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export function AudiobooksPage() {
  return (
    <div className="text-foreground overflow-x-clip">
      <SeoHead
        title="Make audiobooks from a manuscript | Mirli"
        description="Import EPUB, PDF, Word or text, cast a narrator and a voice per character, fix pronunciations, add music under chapters, check against ACX's numbers and export MP3, M4B, FLAC or WAV. Then listen with read-along text."
        path="/audiobooks"
        image="/product/app-audiobook-cast.jpg"
        imageAlt="The Mirli audiobook editor: chapters, paragraphs tagged with who reads each one, the cast and the chapter's timeline"
        jsonLd={[softwareAppJsonLd()]}
      />
      <a
        href="#main"
        className="bg-card ring-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>
      <main id="main">
        {/* The order is the order a book is made in: in, cast, pronounce,
            voice, beds, out, then listening to it; the assistant and the
            agent tools after, as another way to do all of the above. */}
        <Hero />
        <Import />
        <Cast />
        <Pronounce />
        <Render />
        <Beds />
        <Export />
        <Listen />
        <Assistant />
        <Agents />
        <UndoAndTrash />
        <Close />
      </main>
    </div>
  );
}
