#!/usr/bin/env node
/**
 * Build `src/audiobook/classics/classics.json`, the bundled library of
 * public-domain stories, poems and novellas the audiobook builder offers as
 * "Start from a classic".
 *
 * Source: Standard Ebooks (https://standardebooks.org). Each edition carries
 * an "Uncopyright" page stating that the text is believed to be in the US
 * public domain. The editors release their own work (proofreading, markup,
 * metadata) under CC0 1.0, which dedicates it to the worldwide public domain.
 * Every author and translator below died in 1946 or earlier, so each work is
 * also out of copyright where the term is life plus 70 years. Countries with
 * longer terms (Mexico's life plus 100, for one) can differ, so the app
 * repeats Standard Ebooks' advice to check local law.
 *
 * The script fetches one single-page edition per source book, two seconds
 * apart, and only the URLs listed here. Set CLASSICS_CACHE to a folder to
 * reuse downloads between runs.
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

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      version: 1,
      source: "Standard Ebooks (standardebooks.org): texts believed to be in the US public domain; editorial work released under CC0 1.0.",
      works,
    },
    null,
    1,
  ) + "\n",
);
console.log(`\n${works.length} works -> ${OUT}`);
