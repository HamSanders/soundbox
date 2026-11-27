#!/usr/bin/env node
/**
 * Build `src/audiobook/classics/classics.json`, the bundled library of
 * public-domain stories, poems and novellas the audiobook builder offers as
 * "Start from a classic".
 *
 * Sources:
 * - Standard Ebooks (https://standardebooks.org). Each edition carries an
 *   "Uncopyright" page stating that the text is believed to be in the US
 *   public domain. The editors release their own work (proofreading, markup,
 *   metadata) under CC0 1.0, which dedicates it to the worldwide public domain.
 * - Project Gutenberg plain-text editions, for works Standard Ebooks doesn't
 *   carry. Only the public-domain text is kept: the Project Gutenberg header,
 *   licence and footer are stripped, as its licence asks of anyone who
 *   redistributes the text without the trademark
 *   (https://www.gutenberg.org/policy/license). Files come from the PGLAF
 *   mirror, as Gutenberg's robot policy asks of automated downloads
 *   (https://www.gutenberg.org/policy/robot_access.html).
 *
 * Every author and translator below died in 1946 or earlier, so each work is
 * also out of copyright where the term is life plus 70 years. Countries with
 * longer terms (Mexico's life plus 100, for one) can differ, so the app
 * repeats the advice to check local law.
 *
 * The script fetches one edition per source book, two seconds apart, and
 * only the URLs listed here. Set CLASSICS_CACHE to a folder to reuse
 * downloads between runs.
 *
 *   node scripts/build-classics.mjs
 *   CLASSICS_CACHE=/tmp/se node scripts/build-classics.mjs
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DomUtils, parseDocument } from "htmlparser2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src", "audiobook", "classics", "classics.json");
const SE = "https://standardebooks.org/ebooks";
const UA = "Mirli classics catalogue builder (+https://github.com/HamSanders/soundbox)";

/**
 * The works. `sections` are element ids in the Standard Ebooks single-page
 * edition: one id is one chapter titled after the work, several ids are a
 * chapter each. Descriptions are our own.
 */
const WORKS = [
  // Short stories
  { id: "gift-of-the-magi", title: "The Gift of the Magi", author: "O. Henry", life: "1862–1910", year: 1905, form: "story", genres: ["Short stories", "Holiday"],
    description: "A young couple with almost no money each give up their most treasured possession to buy the other a Christmas present.",
    book: "o-henry/short-fiction", sections: ["the-gift-of-the-magi"] },
  { id: "last-leaf", title: "The Last Leaf", author: "O. Henry", life: "1862–1910", year: 1907, form: "story", genres: ["Short stories"],
    description: "A painter sick with pneumonia believes she will die when the last ivy leaf outside her window falls.",
    book: "o-henry/short-fiction", sections: ["the-last-leaf"] },
  { id: "ransom-of-red-chief", title: "The Ransom of Red Chief", author: "O. Henry", life: "1862–1910", year: 1907, form: "story", genres: ["Short stories", "Comedy"],
    description: "Two kidnappers snatch a banker's son and soon find the boy is far more trouble than any ransom is worth.",
    book: "o-henry/short-fiction", sections: ["the-ransom-of-red-chief"] },
  { id: "telltale-heart", title: "The Telltale Heart", author: "Edgar Allan Poe", life: "1809–1849", year: 1843, form: "story", genres: ["Short stories", "Horror"],
    description: "A narrator insists on his sanity while describing a murder, and the sound that gives him away.",
    book: "edgar-allan-poe/short-fiction", sections: ["the-telltale-heart"] },
  { id: "cask-of-amontillado", title: "The Cask of Amontillado", author: "Edgar Allan Poe", life: "1809–1849", year: 1846, form: "story", genres: ["Short stories", "Horror"],
    description: "During carnival, a man lures a rival into the family catacombs with the promise of a rare wine.",
    book: "edgar-allan-poe/short-fiction", sections: ["the-cask-of-amontillado"] },
  { id: "masque-of-the-red-death", title: "The Masque of the Red Death", author: "Edgar Allan Poe", life: "1809–1849", year: 1842, form: "story", genres: ["Short stories", "Horror"],
    description: "A prince walls himself and his court inside an abbey to wait out a plague, and holds a masked ball.",
    book: "edgar-allan-poe/short-fiction", sections: ["the-masque-of-the-red-death"] },
  { id: "monkeys-paw", title: "The Monkey’s Paw", author: "W. W. Jacobs", life: "1863–1943", year: 1902, form: "story", genres: ["Short stories", "Horror"],
    description: "A family is given a mummified paw said to grant three wishes, and learns what each wish costs.",
    book: "w-w-jacobs/the-lady-of-the-barge", sections: ["the-monkeys-paw"] },
  { id: "dream-of-an-hour", title: "The Dream of an Hour", subtitle: "also known as “The Story of an Hour”", author: "Kate Chopin", life: "1850–1904", year: 1894, form: "story", genres: ["Short stories"],
    description: "A woman with a weak heart is told her husband has died, and spends the next hour alone in her room.",
    book: "kate-chopin/short-fiction", sections: ["the-dream-of-an-hour"] },
  { id: "scandal-in-bohemia", title: "A Scandal in Bohemia", author: "Arthur Conan Doyle", life: "1859–1930", year: 1891, form: "story", genres: ["Short stories", "Mystery"],
    description: "Sherlock Holmes is hired by a king to recover a compromising photograph, and meets Irene Adler.",
    book: "arthur-conan-doyle/the-adventures-of-sherlock-holmes", sections: ["a-scandal-in-bohemia"] },
  { id: "lady-with-the-dog", title: "The Lady with the Dog", author: "Anton Chekhov", life: "1860–1904", translator: "Constance Garnett", translator_life: "1861–1946", year: 1899, form: "story", genres: ["Short stories", "Romance"],
    description: "Two married strangers meet at a seaside resort in Yalta, and an affair neither expects to last changes them both.",
    book: "anton-chekhov/short-fiction/constance-garnett", sections: ["the-lady-with-the-dog"] },
  { id: "open-window", title: "The Open Window", author: "Saki", life: "1870–1916", year: 1914, form: "story", genres: ["Short stories", "Comedy"],
    description: "A nervous visitor in the country hears a strange story from his hostess's niece about the open French window.",
    book: "saki/short-fiction", sections: ["the-open-window"] },
  { id: "sredni-vashtar", title: "Sredni Vashtar", author: "Saki", life: "1870–1916", year: 1911, form: "story", genres: ["Short stories", "Horror"],
    description: "A sickly boy under a strict guardian secretly worships a ferret he keeps in the garden shed.",
    book: "saki/short-fiction", sections: ["sredni-vashtar"] },
  { id: "rip-van-winkle", title: "Rip Van Winkle", author: "Washington Irving", life: "1783–1859", year: 1819, form: "story", genres: ["Short stories", "Folk tales"],
    description: "A good-natured villager wanders into the Catskill Mountains, falls asleep, and wakes twenty years later.",
    book: "washington-irving/the-sketchbook-of-geoffrey-crayon-gent", sections: ["rip-van-winkle"] },
  { id: "legend-of-sleepy-hollow", title: "The Legend of Sleepy Hollow", author: "Washington Irving", life: "1783–1859", year: 1820, form: "story", genres: ["Short stories", "Horror", "Folk tales"],
    description: "Schoolmaster Ichabod Crane courts a farmer's daughter and rides home one night past the haunt of the Headless Horseman.",
    book: "washington-irving/the-sketchbook-of-geoffrey-crayon-gent", sections: ["the-legend-of-sleepy-hollow"] },

  // For children
  { id: "happy-prince", title: "The Happy Prince", author: "Oscar Wilde", life: "1854–1900", year: 1888, form: "children", genres: ["Children", "Fairy tales"],
    description: "A jewelled statue and a swallow who stays behind for the winter help the poor of the city below.",
    book: "oscar-wilde/childrens-stories", sections: ["the-happy-prince"] },
  { id: "selfish-giant", title: "The Selfish Giant", author: "Oscar Wilde", life: "1854–1900", year: 1888, form: "children", genres: ["Children", "Fairy tales"],
    description: "A giant walls the children out of his garden, and winter never leaves it.",
    book: "oscar-wilde/childrens-stories", sections: ["the-selfish-giant"] },
  { id: "nightingale-and-the-rose", title: "The Nightingale and the Rose", author: "Oscar Wilde", life: "1854–1900", year: 1888, form: "children", genres: ["Children", "Fairy tales"],
    description: "A nightingale gives everything to make a red rose for a student who wants it for a girl.",
    book: "oscar-wilde/childrens-stories", sections: ["the-nightingale-and-the-rose"] },
  { id: "whale-got-his-throat", title: "How the Whale Got His Throat", author: "Rudyard Kipling", life: "1865–1936", year: 1902, form: "children", genres: ["Children", "Fables"],
    description: "A whale that eats every fish in the sea swallows a shipwrecked mariner, who has a plan.",
    book: "rudyard-kipling/just-so-stories", sections: ["how-the-whale-got-his-throat"] },
  { id: "leopard-got-his-spots", title: "How the Leopard Got His Spots", author: "Rudyard Kipling", life: "1865–1936", year: 1902, form: "children", genres: ["Children", "Fables"],
    description: "When the animals of the plain move into the forest's shadows, the Leopard and the Ethiopian change their looks to hunt them.",
    book: "rudyard-kipling/just-so-stories", sections: ["how-the-leopard-got-his-spots"] },

  // Novellas and books
  { id: "christmas-carol", title: "A Christmas Carol", author: "Charles Dickens", life: "1812–1870", year: 1843, form: "novella", genres: ["Novellas", "Holiday"],
    description: "The miser Ebenezer Scrooge is visited by the ghost of his partner and three spirits on Christmas Eve.",
    book: "charles-dickens/a-christmas-carol", sections: ["preface", "chapter-1", "chapter-2", "chapter-3", "chapter-4", "chapter-5"] },
  { id: "jekyll-and-hyde", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Robert Louis Stevenson", life: "1850–1894", year: 1886, form: "novella", genres: ["Novellas", "Horror", "Mystery"],
    description: "A London lawyer looks into the link between his respected friend Dr. Jekyll and the brutal Edward Hyde.",
    book: "robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde",
    sections: Array.from({ length: 10 }, (_, i) => `chapter-${i + 1}`) },
  { id: "alice-in-wonderland", title: "Alice’s Adventures in Wonderland", author: "Lewis Carroll", life: "1832–1898", year: 1865, form: "novella", genres: ["Novellas", "Children", "Fantasy"],
    description: "Alice follows a White Rabbit down a hole into a world of shrinking potions, mad tea parties and a furious Queen.",
    book: "lewis-carroll/alices-adventures-in-wonderland/john-tenniel",
    sections: Array.from({ length: 12 }, (_, i) => `chapter-${i + 1}`) },

  // Poems
  { id: "the-raven", title: "The Raven", author: "Edgar Allan Poe", life: "1809–1849", year: 1845, form: "poem", genres: ["Poetry", "Horror"],
    description: "On a December midnight, a grieving student is visited by a raven that answers every question with one word.",
    book: "edgar-allan-poe/poetry", sections: ["the-raven"] },
  { id: "annabel-lee", title: "Annabel Lee", author: "Edgar Allan Poe", life: "1809–1849", year: 1849, form: "poem", genres: ["Poetry"],
    description: "Poe's last complete poem, a ballad of a love that outlasts death in a kingdom by the sea.",
    book: "edgar-allan-poe/poetry", sections: ["annabel-lee"] },
  { id: "ode-to-a-nightingale", title: "Ode to a Nightingale", author: "John Keats", life: "1795–1821", year: 1819, form: "poem", genres: ["Poetry"],
    description: "Listening to a nightingale's song, the poet longs to leave a world of sorrow and age behind.",
    book: "john-keats/poetry", sections: ["ode-to-a-nightingale"] },
  { id: "to-autumn", title: "To Autumn", author: "John Keats", life: "1795–1821", year: 1820, form: "poem", genres: ["Poetry"],
    description: "Three stanzas on the ripeness, harvest and quiet sounds of the season.",
    book: "john-keats/poetry", sections: ["to-autumn"] },
  { id: "o-captain-my-captain", title: "O Captain! My Captain!", author: "Walt Whitman", life: "1819–1892", year: 1865, form: "poem", genres: ["Poetry"],
    description: "An elegy for Abraham Lincoln, cast as a sailor mourning his captain as the ship comes home.",
    book: "walt-whitman/leaves-of-grass", sections: ["o-captain-my-captain"] },
];

/**
 * Works from Project Gutenberg plain-text editions. `pg` is the ebook number.
 * Each piece is one chapter: it starts after the line equal to `heading`, or
 * at the line starting with `first` (a poem's first line, skipping an
 * editor's note above it), and runs to the line equal to `until`, an editor's
 * note or `***` divider, or three blank lines in a row. Pieces are found in
 * order, each after the last. Descriptions are our own.
 */
const GRIMM = { author: "Jacob and Wilhelm Grimm", life: "1785–1863", translator: "Margaret Hunt", translator_life: "1831–1912", pg: 5314 };
const PG_WORKS = [
  { id: "yellow-wallpaper", title: "The Yellow Wallpaper", author: "Charlotte Perkins Gilman", life: "1860–1935", year: 1892, form: "story", genres: ["Short stories", "Horror"],
    description: "Confined to a rented country house for a “rest cure”, a young mother becomes fixed on the pattern of her bedroom wallpaper.",
    pg: 1952, pieces: [{ heading: "By Charlotte Perkins Gilman", until: /^\*\*\* END/ }] },
  { id: "aesops-fables", title: "Aesop’s Fables: a selection", author: "Aesop", life: "c. 620–564 BC", translator: "George Fyler Townsend", translator_life: "1814–1900", year: 1867, form: "children", genres: ["Fables", "Children"],
    description: "Fifteen of the best-known fables, from the Hare and the Tortoise to the Boy who cried Wolf, each ending in its moral.",
    pg: 21, pieces: [
      "The Lion And The Mouse", "The Ants and the Grasshopper", "The Hare and the Tortoise", "The Dog and the Shadow", "The Wolf in Sheep’s Clothing",
      "The Boy and the Filberts", "The Shepherd’s Boy and the Wolf", "The Fox and the Crow", "The Mice in Council", "The Milk-Woman and Her Pail",
      "The Hen and the Golden Eggs", "The Crow and the Pitcher", "The Fox and the Grapes", "The Town Mouse and the Country Mouse", "The North Wind and the Sun",
    ].map((h) => ({ heading: h, title: h.replace("Lion And The", "Lion and the") })) },
  { ...GRIMM, id: "frog-king", title: "The Frog-King, or Iron Henry", year: 1812, form: "children", genres: ["Fairy tales", "Children"],
    description: "A princess promises a frog her friendship in return for her golden ball, and her father makes her keep her word.",
    pieces: [{ heading: "1 The Frog-King, or Iron Henry" }] },
  { ...GRIMM, id: "hansel-and-grethel", title: "Hansel and Grethel", subtitle: "Hansel and Gretel", year: 1812, form: "children", genres: ["Fairy tales", "Children"],
    description: "Abandoned in the forest, a brother and sister find a house made of bread and cake, and the witch who lives in it.",
    pieces: [{ heading: "15 Hansel and Grethel" }] },
  { ...GRIMM, id: "little-red-cap", title: "Little Red-Cap", subtitle: "Little Red Riding Hood", year: 1812, form: "children", genres: ["Fairy tales", "Children"],
    description: "A girl in a red cap takes cake and wine to her grandmother and meets a wolf in the wood.",
    pieces: [{ heading: "26 Little Red-Cap" }] },
  { ...GRIMM, id: "bremen-town-musicians", title: "The Bremen Town-Musicians", year: 1819, form: "children", genres: ["Fairy tales", "Children", "Comedy"],
    description: "An old donkey, dog, cat and rooster set off to be town musicians, and find a robbers' house on the way.",
    pieces: [{ heading: "27 The Bremen Town-Musicians" }] },
  { ...GRIMM, id: "elves-and-the-shoemaker", title: "The Elves and the Shoemaker", year: 1812, form: "children", genres: ["Fairy tales", "Children"],
    description: "A poor shoemaker leaves out his last leather at night and finds a finished pair of shoes in the morning.",
    pieces: [{ heading: "FIRST STORY", until: "SECOND STORY", after: "39 The Elves" }] },
  { ...GRIMM, id: "little-snow-white", title: "Little Snow-white", year: 1812, form: "children", genres: ["Fairy tales", "Children"],
    description: "A queen's magic mirror names her stepdaughter the fairest in the land, and the girl flees to the seven dwarfs.",
    pieces: [{ heading: "53 Little Snow-white" }] },
  { ...GRIMM, id: "rumpelstiltskin", title: "Rumpelstiltskin", year: 1812, form: "children", genres: ["Fairy tales", "Children"],
    description: "A miller's daughter must spin straw into gold, and a little man helps her for a price she can't pay.",
    pieces: [{ heading: "55 Rumpelstiltskin" }] },
  { id: "dickinson-poems", title: "Poems of Emily Dickinson: a selection", author: "Emily Dickinson", life: "1830–1886", year: 1890, form: "poem", genres: ["Poetry"],
    description: "Eleven poems, from “Because I could not stop for Death” to “Hope is the thing with feathers”, as first printed in 1890–96 with her editors’ punctuation.",
    pg: 12242, pieces: [
      "Success is counted sweetest", "The soul selects her own society,", "I taste a liquor never brewed,", "There's a certain slant of light,",
      "I never saw a moor,", "Because I could not stop for Death,", "I'm nobody! Who are you?", "Hope is the thing with feathers",
      "Wild nights! Wild nights!", "A bird came down the walk:", "I heard a fly buzz when I died;",
    ].map((f) => ({ first: f, title: f.replace(/[,;:]$/, "") })) },
  { id: "songs-of-innocence-and-experience", title: "Songs of Innocence and of Experience", author: "William Blake", life: "1757–1827", year: 1794, form: "poem", genres: ["Poetry"],
    description: "Blake's two linked books of short lyrics, from “The Lamb” to “The Tiger” and “London”, showing “the two contrary states of the human soul”.",
    pg: 1934, pieces: blakePieces() },
  { id: "goblin-market", title: "Goblin Market", author: "Christina Rossetti", life: "1830–1894", year: 1862, form: "poem", genres: ["Poetry", "Fantasy"],
    description: "Two sisters hear goblin merchants crying their fruit at dusk. One eats, and the other must save her.",
    pg: 16950, pieces: [{ heading: "GOBLIN MARKET" }] },
  { id: "ozymandias", title: "Ozymandias", author: "Percy Bysshe Shelley", life: "1792–1822", year: 1818, form: "poem", genres: ["Poetry"],
    description: "A traveller describes a ruined statue in the desert and the boast carved on its pedestal.",
    pg: 4800, pieces: [{ first: "I met a traveller from an antique land" }] },
  { id: "ode-to-the-west-wind", title: "Ode to the West Wind", author: "Percy Bysshe Shelley", life: "1792–1822", year: 1820, form: "poem", genres: ["Poetry"],
    description: "The poet calls on the autumn wind, destroyer and preserver, to scatter his words like leaves.",
    pg: 4800, pieces: [{ first: "O wild West Wind, thou breath of Autumn’s being," }] },
  { id: "to-a-skylark", title: "To a Skylark", author: "Percy Bysshe Shelley", life: "1792–1822", year: 1820, form: "poem", genres: ["Poetry"],
    description: "A skylark's song, heard but never seen, becomes the image of a joy no human poet can reach.",
    pg: 4800, pieces: [{ first: "Hail to thee, blithe Spirit!" }] },
];

/** Blake's book in the 1901 edition's order: two parts, each poem a chapter. */
function blakePieces() {
  const innocence = ["INTRODUCTION", "THE SHEPHERD", "THE ECHOING GREEN", "THE LAMB", "THE LITTLE BLACK BOY", "THE BLOSSOM", "THE CHIMNEY-SWEEPER",
    "THE LITTLE BOY LOST", "THE LITTLE BOY FOUND", "LAUGHING SONG", "A CRADLE SONG", "THE DIVINE IMAGE", "HOLY THURSDAY", "NIGHT", "SPRING",
    "NURSE’S SONG", "INFANT JOY", "A DREAM", "ON ANOTHER’S SORROW"];
  const experience = ["INTRODUCTION", "EARTH’S ANSWER", "THE CLOD AND THE PEBBLE", "HOLY THURSDAY", "THE LITTLE GIRL LOST", "THE LITTLE GIRL FOUND",
    "THE CHIMNEY-SWEEPER", "NURSE’S SONG", "THE SICK ROSE", "THE FLY", "THE ANGEL", "THE TIGER", "MY PRETTY ROSE TREE", "AH, SUNFLOWER", "THE LILY",
    "THE GARDEN OF LOVE", "THE LITTLE VAGABOND", "LONDON", "THE HUMAN ABSTRACT", "INFANT SORROW", "A POISON TREE", "A LITTLE BOY LOST",
    "A LITTLE GIRL LOST", "A DIVINE IMAGE", "A CRADLE SONG", "TO TIRZAH", "THE SCHOOLBOY", "THE VOICE OF THE ANCIENT BARD"];
  const title = (h) => h.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, s, c) => s + c.toUpperCase()).replace(/ (And|Of|The|On)\b/g, (m) => m.toLowerCase());
  // Headings match whole unindented lines, so the indented title page and
  // contents are skipped; the shared titles resolve in order.
  return [
    ...innocence.map((h) => ({ heading: h, title: `Innocence: ${title(h)}` })),
    ...experience.map((h, i) => ({ heading: h, title: `Experience: ${title(h)}`, ...(i === 0 ? { after: "SONGS OF EXPERIENCE" } : {}) })),
  ];
}

/* ------------------------------------------------------------- fetching */

const cacheDir = process.env.CLASSICS_CACHE ?? null;
let lastFetch = 0;

async function page(book) {
  const name = `${book.replaceAll("/", "_")}.html`;
  if (cacheDir && existsSync(join(cacheDir, name))) return readFile(join(cacheDir, name), "utf8");
  const wait = lastFetch + 2000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const url = `${SE}/${book}/text/single-page`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = await res.text();
  if (cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, name), html);
  }
  return html;
}

const PGLAF = "https://gutenberg.pglaf.org";

/** A Gutenberg plain-text edition from the PGLAF mirror, as LF lines. */
async function pgText(n) {
  const name = `pg${n}.txt`;
  let text = cacheDir && existsSync(join(cacheDir, name)) ? await readFile(join(cacheDir, name), "utf8") : null;
  if (!text) {
    const s = String(n);
    const dir = s.length === 1 ? `0/${s}` : `${[...s.slice(0, -1)].join("/")}/${s}`;
    for (const file of [`${s}-0.txt`, `${s}.txt`]) {
      const wait = lastFetch + 2000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastFetch = Date.now();
      const res = await fetch(`${PGLAF}/${dir}/${file}`, { headers: { "User-Agent": UA } });
      if (res.ok) {
        text = await res.text();
        break;
      }
    }
    if (!text) throw new Error(`Gutenberg #${n}: not on the mirror`);
    if (cacheDir) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, name), text);
    }
  }
  if (/Temporarily Down for Maintenance/.test(text)) throw new Error(`Gutenberg #${n}: got the maintenance page`);
  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  // Keep only the work: drop the Gutenberg header and everything from the end marker on.
  const start = lines.findIndex((l) => /^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG/.test(l));
  const end = lines.findIndex((l) => /^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/.test(l));
  if (start < 0 || end < 0) throw new Error(`Gutenberg #${n}: no start/end markers`);
  return lines.slice(start + 1, end).concat(["*** END"]);
}

/** Inline clean-up for a Gutenberg line: italics marks, line numbers, notes. */
function pgLine(line) {
  return line
    .replace(INVISIBLE, "")
    .replace(/\s{2,}_?\d+\s*$/, "") // verse line numbers, e.g. "…command,      _5" or "…raspberries,     10"
    .replace(/\[\d+\]/g, "") // footnote markers
    .replace(/_([^_]+)_/g, "$1") // _italics_
    .replace(/\s*--\s*/g, (m) => (/\s/.test(m) ? " — " : "—"))
    .replace(/\s+/g, " ")
    .trim();
}

/** Small capitals at the start of a fable ("THE ANTS were…") as plain words. */
// One space between words, so a run of capitals can only split one way.
const unshout = (p) => p.replace(/^[A-Z][A-Z’'-]*(?:\s[A-Z][A-Z’'-]*)*?(?=\s[a-z]|[,.;:]|$)/, (run) =>
  run.replace(/[A-Z][A-Z’'-]+/g, (w) => (w.length === 1 ? w : w[0] + w.slice(1).toLowerCase())));

const same = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** One piece of a Gutenberg text, from `from` (a line index): paragraphs and where it stopped. */
function pgPiece(lines, piece, from, verse, id) {
  let i = from;
  if (piece.after) {
    while (i < lines.length && lines[i].trimEnd() !== piece.after) i++;
    if (i >= lines.length) throw new Error(`${id}: no line "${piece.after}"`);
  }
  if (piece.heading) {
    while (i < lines.length && lines[i].trimEnd() !== piece.heading) i++;
    if (i >= lines.length) throw new Error(`${id}: no heading "${piece.heading}"`);
    i++;
  } else {
    while (i < lines.length && !lines[i].trim().replace(/\s+/g, " ").startsWith(piece.first)) i++;
    if (i >= lines.length) throw new Error(`${id}: no line starting "${piece.first}"`);
  }
  const paragraphs = [];
  let block = [];
  let blanks = 0;
  const flush = () => {
    // A bare section number ("2.") would be read aloud: drop it.
    const kept = block.map(pgLine).filter((l) => l && !/^\[(Picture|Illustration)/i.test(l) && !/^[IVXL\d]+\.?$/.test(l));
    if (kept.length) paragraphs.push(verse ? kept.join("\n") : unshout(kept.join(" ")));
    block = [];
  };
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const stop =
      raw.startsWith("*** END") ||
      (piece.until instanceof RegExp ? piece.until.test(raw) : piece.until && raw.trimEnd() === piece.until) ||
      /^(NOTE:|NOTES:|\*\*\*)\s*$/.test(raw.trim());
    if (stop) break;
    if (!raw.trim()) {
      blanks++;
      flush();
      if (blanks >= 3 && paragraphs.length && !piece.until) break;
      continue;
    }
    blanks = 0;
    // An editor's bracketed note before a poem: skip it whole.
    if (!paragraphs.length && !block.length && raw.trim().startsWith("[")) {
      while (i < lines.length && !lines[i].includes("]")) i++;
      continue;
    }
    block.push(raw);
  }
  flush();
  if (!paragraphs.length) throw new Error(`${id}: "${piece.heading ?? piece.first}" has no text`);
  return { paragraphs, next: i };
}

/* ------------------------------------------------------------ extraction */

const INVISIBLE = /[­⁠​]/g;
const isEl = (n) => n.type === "tag";
const epubType = (el) => el.attribs?.["epub:type"] ?? "";
const ROMAN = /^[IVXLC]+\.?$/;

/** Text of a node, with <br> as a newline and note references dropped. */
function textOf(node) {
  if (node.type === "text") return node.data;
  if (!isEl(node)) return "";
  if (node.name === "br") return "\n";
  if (node.name === "a" && /noteref/.test(epubType(node))) return "";
  if (node.name === "img") return node.attribs.alt ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function clean(text, verse) {
  const lines = text.replace(INVISIBLE, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  return verse ? lines.join("\n") : lines.join(" ");
}

/** The section's own heading, e.g. "Stave I: Marley’s Ghost" or "Chapter I: Down the Rabbit-Hole". */
function headingOf(section) {
  const head = section.children.find((c) => isEl(c) && (c.name === "header" || c.name === "hgroup" || /^h[1-6]$/.test(c.name)));
  if (!head) return null;
  const hgroup = head.name === "hgroup" ? head : DomUtils.findOne((e) => e.name === "hgroup", [head], true) ?? head;
  const parts = [];
  for (const c of hgroup.name === "hgroup" ? hgroup.children : [hgroup]) {
    if (!isEl(c)) continue;
    const t = clean(textOf(c), false);
    if (t) parts.push(t);
  }
  if (!parts.length) return null;
  const [label, ...rest] = parts;
  if (!rest.length) return label;
  return ROMAN.test(label) ? `Chapter ${label}: ${rest.join(" ")}` : `${label}: ${rest.join(" ")}`;
}

/** Paragraphs and scene breaks of a section, in reading order. */
function body(section) {
  const paragraphs = [];
  const breaks = new Set();
  const markBreak = () => {
    if (paragraphs.length) breaks.add(paragraphs.length);
  };
  const walk = (node, verse) => {
    for (const c of node.children ?? []) {
      if (!isEl(c)) continue;
      const v = verse || /z3998:(poem|verse|song|hymn)/.test(epubType(c));
      if (c.name === "header" || c.name === "hgroup" || /^h[1-6]$/.test(c.name)) continue;
      if (c.name === "section" || c.name === "article") {
        markBreak();
        walk(c, v);
        markBreak();
        continue;
      }
      if (c.name === "hr") {
        markBreak();
        continue;
      }
      if (c.name === "p" || c.name === "li" || c.name === "dt" || c.name === "dd") {
        const text = clean(textOf(c), v);
        if (text) paragraphs.push(text);
        continue;
      }
      if (["figure", "img", "table", "aside", "nav"].includes(c.name)) continue;
      walk(c, v);
    }
  };
  walk(section, /z3998:(poem|verse|song|hymn)/.test(epubType(section)));
  return {
    paragraphs,
    breaks: [...breaks].filter((i) => i > 0 && i < paragraphs.length).sort((a, b) => a - b),
  };
}

const words = (paras) => paras.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);

/* ----------------------------------------------------------------- main */

const docs = new Map();
const works = [];
for (const w of WORKS) {
  if (!docs.has(w.book)) docs.set(w.book, parseDocument(await page(w.book)));
  const doc = docs.get(w.book);
  const sections = w.sections.map((id) => {
    const el = DomUtils.findOne((e) => e.attribs?.id === id, doc.children, true);
    if (!el) throw new Error(`${w.id}: no element #${id} in ${w.book}`);
    const { paragraphs, breaks } = body(el);
    if (!paragraphs.length) throw new Error(`${w.id}: #${id} has no text`);
    const title = w.sections.length === 1 ? w.title : (headingOf(el) ?? id);
    return {
      title,
      kind: id === "preface" ? "front_matter" : "chapter",
      included: true,
      paragraphs,
      // A poem's stanzas are already paragraphs; a scene-break pause between them is too long.
      ...(breaks.length && w.form !== "poem" ? { breaks } : {}),
    };
  });
  const { book, sections: _ids, ...meta } = w;
  const count = sections.reduce((n, s) => n + words(s.paragraphs), 0);
  works.push({
    ...meta,
    language: "en",
    words: count,
    source: { name: "Standard Ebooks", url: `${SE}/${book}` },
    sections,
  });
  console.log(`${w.id.padEnd(26)} ${String(sections.length).padStart(2)} ch  ${String(count).padStart(6)} words`);
}

const texts = new Map();
for (const w of PG_WORKS) {
  if (!texts.has(w.pg)) texts.set(w.pg, await pgText(w.pg));
  const lines = texts.get(w.pg);
  const verse = w.form === "poem";
  let at = 0;
  const sections = w.pieces.map((piece) => {
    const { paragraphs, next } = pgPiece(lines, piece, at, verse, w.id);
    at = next;
    return { title: w.pieces.length === 1 ? w.title : piece.title, kind: "chapter", included: true, paragraphs };
  });
  const { pg, pieces: _p, ...meta } = w;
  const count = sections.reduce((n, s) => n + words(s.paragraphs), 0);
  works.push({
    ...meta,
    language: "en",
    words: count,
    source: { name: "Project Gutenberg", url: `https://www.gutenberg.org/ebooks/${pg}` },
    sections,
  });
  console.log(`${w.id.padEnd(26)} ${String(sections.length).padStart(2)} ch  ${String(count).padStart(6)} words`);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      version: 1,
      source:
        "Standard Ebooks (standardebooks.org): texts believed to be in the US public domain; editorial work released under CC0 1.0. " +
        "Project Gutenberg (gutenberg.org) plain-text editions: public-domain texts, with the Project Gutenberg header, licence and footer removed.",
      works,
    },
    null,
    1,
  ) + "\n",
);
console.log(`\n${works.length} works -> ${OUT}`);
