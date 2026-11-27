/**
 * Language-aware pieces of the importer: chapter heading words, number
 * words, front/back-matter section names, and a small language guess for
 * files whose metadata doesn't say.
 *
 * Languages: English, German, French, Spanish, Italian, Portuguese, Dutch,
 * Polish, Russian, Chinese and Japanese. Adding one means adding a row to
 * each table below; nothing else changes.
 */

import type { ChapterKind } from "../types.js";

export type Lang = "en" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "pl" | "ru" | "zh" | "ja";

/* ------------------------------------------------------------ numbering */

/** Words that introduce a numbered division ("Chapter", "Kapitel", "Глава"). */
const DIVISION_WORDS: Record<Exclude<Lang, "zh" | "ja">, string[]> = {
  en: ["chapter", "part", "book", "volume", "act", "letter", "section"],
  de: ["kapitel", "teil", "buch", "band", "akt", "abschnitt", "brief"],
  fr: ["chapitre", "partie", "livre", "tome", "acte", "lettre"],
  es: ["capítulo", "capitulo", "parte", "libro", "tomo", "acto", "carta"],
  it: ["capitolo", "parte", "libro", "volume", "atto", "lettera"],
  pt: ["capítulo", "capitulo", "parte", "livro", "volume", "ato", "acto", "carta"],
  nl: ["hoofdstuk", "deel", "boek", "bedrijf", "brief"],
  pl: ["rozdział", "rozdzial", "część", "czesc", "księga", "ksiega", "tom", "akt", "list"],
  ru: ["глава", "часть", "книга", "том", "действие", "письмо"],
};

/** Cardinal and ordinal number words, one to twenty plus tens; enough for
 *  headings written out ("Kapitel Eins", "Chapitre premier", "Глава первая"). */
const NUMBER_WORDS: Record<Exclude<Lang, "zh" | "ja">, string[]> = {
  en: [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
    "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "last", "final",
  ],
  de: [
    "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn",
    "vierzehn", "fünfzehn", "zwanzig", "dreißig", "erstes", "zweites", "drittes", "viertes", "fünftes", "sechstes",
    "siebtes", "achtes", "neuntes", "zehntes", "erster", "zweiter", "dritter", "letztes", "letzter",
  ],
  fr: [
    "un", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize",
    "quatorze", "quinze", "seize", "vingt", "trente", "premier", "première", "deuxième", "second", "seconde",
    "troisième", "quatrième", "cinquième", "sixième", "septième", "huitième", "neuvième", "dixième", "dernier",
  ],
  es: [
    "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece",
    "catorce", "quince", "veinte", "treinta", "primero", "primera", "segundo", "segunda", "tercero", "tercera",
    "cuarto", "cuarta", "quinto", "quinta", "sexto", "séptimo", "octavo", "noveno", "décimo", "último", "última",
  ],
  it: [
    "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici",
    "tredici", "venti", "trenta", "primo", "prima", "secondo", "seconda", "terzo", "terza", "quarto", "quinto",
    "sesto", "settimo", "ottavo", "nono", "decimo", "ultimo",
  ],
  pt: [
    "um", "uma", "dois", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
    "treze", "vinte", "trinta", "primeiro", "primeira", "segundo", "segunda", "terceiro", "terceira", "quarto",
    "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo", "último",
  ],
  nl: [
    "een", "één", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht", "negen", "tien", "elf", "twaalf",
    "dertien", "twintig", "dertig", "eerste", "tweede", "derde", "vierde", "vijfde", "zesde", "zevende", "achtste",
    "negende", "tiende", "laatste",
  ],
  pl: [
    "jeden", "dwa", "trzy", "cztery", "pięć", "sześć", "siedem", "osiem", "dziewięć", "dziesięć", "jedenaście",
    "dwanaście", "dwadzieścia", "pierwszy", "pierwsza", "drugi", "druga", "trzeci", "trzecia", "czwarty", "piąty",
    "szósty", "siódmy", "ósmy", "dziewiąty", "dziesiąty", "ostatni", "ostatnia",
  ],
  ru: [
    "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать",
    "двенадцать", "двадцать", "тридцать", "первая", "первый", "вторая", "второй", "третья", "третий", "четвёртая",
    "четвертая", "пятая", "шестая", "седьмая", "восьмая", "девятая", "десятая", "последняя", "последний",
  ],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (words: string[]) => [...new Set(words)].sort((a, b) => b.length - a.length).map(esc).join("|");

const ROMAN = "[ivxlcdm]+";
const NUMBER = `(?:\\d{1,4}|${ROMAN}|(?:(?:${alt(Object.values(NUMBER_WORDS).flat())})(?:[- ](?:${alt(Object.values(NUMBER_WORDS).flat())}))?))`;

/** "Kapitel 3", "CHAPITRE XII. Le bal", "Глава первая", "Chapter the First". */
const NUMBERED = new RegExp(
  `^(?:${alt(Object.values(DIVISION_WORDS).flat())})\\s+(?:the\\s+)?${NUMBER}(?![\\p{L}\\d])[.:—–-]?\\s*.{0,80}$`,
  "iu",
);
/** Reversed order: "Erstes Kapitel", "Premier chapitre", "Part One" is above. */
const ORDINAL_FIRST = new RegExp(
  `^(?:${alt(Object.values(NUMBER_WORDS).flat())})\\s+(?:${alt(Object.values(DIVISION_WORDS).flat())})(?![\\p{L}])[.:—–-]?\\s*.{0,80}$`,
  "iu",
);
/** Chinese and Japanese: 第一章, 第12回, 第三部, 第二話, 第一節 (with an optional title after). */
const CJK_NUMBERED = /^第\s*[0-9０-９一二三四五六七八九十百千零〇两兩]+\s*[章回节節部卷話话篇幕]\s*.{0,60}$/u;
const CJK_NAMED = /^(?:序章|終章|终章|序言|序|前言|楔子|引子|尾声|尾聲|后记|後記|跋|目录|目錄|目次|版权|版權|奥付|謝辞|谢辞|致谢|致謝|まえがき|あとがき|プロローグ|エピローグ|はじめに|おわりに)(?:\s.{0,40})?$/u;

/* ----------------------------------------------------- matter names */

interface MatterKind {
  kind: ChapterKind;
  included: boolean;
  names: string[];
}

/**
 * Section names by role, all languages together (they rarely collide).
 * Excluded by default: pages a listener doesn't want read aloud.
 */
export const MATTER: Record<string, MatterKind> = {
  copyright: {
    kind: "front_matter",
    included: false,
    names: [
      "copyright", "uncopyright", "legal", "imprint", "colophon", "impressum", "mentions légales", "droits d'auteur", "créditos",
      "derechos de autor", "colofón", "colophon", "copyright e crediti", "colofão", "ficha técnica", "colofon",
      "prawa autorskie", "stopka redakcyjna", "выходные данные", "版权", "版權", "版权信息", "奥付",
    ],
  },
  contents: {
    kind: "front_matter",
    included: false,
    names: [
      "contents", "table of contents", "toc", "inhalt", "inhaltsverzeichnis", "table des matières", "sommaire",
      "índice", "indice", "contenido", "sumário", "sumario", "sommario", "inhoud", "inhoudsopgave", "spis treści",
      "содержание", "оглавление", "目录", "目錄", "目次",
    ],
  },
  title: {
    kind: "front_matter",
    included: false,
    names: ["title page", "half title", "half-title", "cover", "titelseite", "titelblatt", "page de titre", "couverture", "portada", "copertina", "capa", "titelpagina", "strona tytułowa", "обложка", "титул", "封面"],
  },
  alsoBy: {
    kind: "front_matter",
    included: false,
    names: ["also by", "other books by", "books by", "praise for", "vom selben autor", "du même auteur", "del mismo autor", "dello stesso autore", "do mesmo autor", "van dezelfde auteur", "tego autora", "другие книги"],
  },
  dedication: {
    kind: "front_matter",
    included: true,
    names: ["dedication", "epigraph", "widmung", "motto", "dédicace", "épigraphe", "dedicatoria", "epígrafe", "dedica", "epigrafe", "dedicatória", "opdracht", "dedykacja", "motto", "посвящение", "эпиграф", "献词", "獻詞", "题记"],
  },
  foreword: {
    kind: "front_matter",
    included: true,
    names: [
      "foreword", "preface", "introduction", "author's note", "authors note", "a note from the author", "a note on the text",
      "vorwort", "einleitung", "einführung", "geleitwort", "anmerkung des autors", "préface", "avant-propos",
      "introduction", "note de l'auteur", "prefacio", "prólogo del autor", "introducción", "nota del autor",
      "prefazione", "introduzione", "premessa", "nota dell'autore", "prefácio", "introdução", "nota do autor",
      "apresentação", "voorwoord", "inleiding", "woord vooraf", "przedmowa", "wstęp", "wprowadzenie", "od autora",
      "предисловие", "введение", "от автора", "前言", "序言", "序", "まえがき", "はじめに",
    ],
  },
  story: {
    kind: "chapter",
    included: true,
    names: [
      "prologue", "epilogue", "interlude", "coda", "postscript", "prolog", "epilog", "zwischenspiel", "épilogue",
      "intermède", "prólogo", "epílogo", "interludio", "prologo", "epilogo", "intermezzo", "proloog", "epiloog",
      "intermezzo", "пролог", "эпилог", "интерлюдия", "楔子", "引子", "尾声", "尾聲", "序章", "終章", "终章",
      "プロローグ", "エピローグ",
    ],
  },
  backIncluded: {
    kind: "back_matter",
    included: true,
    names: [
      "afterword", "acknowledgements", "acknowledgments", "acknowledgement", "about the author", "about the authors",
      "nachwort", "danksagung", "dank", "über den autor", "über die autorin", "über die autoren", "postface",
      "remerciements", "à propos de l'auteur", "a propos de l'auteur", "l'auteur", "agradecimientos", "epílogo del autor",
      "sobre el autor", "acerca del autor", "el autor", "postfazione", "ringraziamenti", "l'autore", "nota sull'autore",
      "posfácio", "agradecimentos", "sobre o autor", "o autor", "nawoord", "dankwoord", "over de auteur",
      "over de schrijver", "posłowie", "podziękowania", "o autorze", "послесловие", "благодарности", "об авторе",
      "后记", "後記", "跋", "致谢", "致謝", "谢辞", "謝辞", "あとがき", "おわりに", "作者简介", "著者紹介",
    ],
  },
  backExcluded: {
    kind: "back_matter",
    included: false,
    names: [
      "index", "bibliography", "glossary", "endnotes", "notes", "references", "appendix", "further reading",
      "register", "anmerkungen", "literaturverzeichnis", "glossar", "anhang", "quellen", "bibliographie",
      "glossaire", "annexe", "bibliografía", "glosario", "notas", "apéndice", "anexo", "bibliografia", "glossario",
      "appendice", "glossário", "apêndice", "noten", "bibliografie", "woordenlijst", "bijlage", "aantekeningen",
      "przypisy", "bibliografia", "słowniczek", "aneks", "indeks", "примечания", "библиография", "словарь",
      "приложение", "указатель", "注释", "註釋", "参考文献", "附录", "附錄", "索引",
    ],
  },
};

/** Normalise a title for name lookups: lower case, no trailing punctuation,
 *  straight apostrophes. */
function norm(title: string): string {
  return title.trim().toLowerCase().replace(/[’`]/g, "'").replace(/[\s.:;—–-]+$/u, "");
}

const MATTER_LOOKUP: [string, MatterKind][] = Object.values(MATTER)
  .flatMap((m) => m.names.map((n) => [n, m] as [string, MatterKind]))
  .sort((a, b) => b[0].length - a[0].length);

/** A section's role from its title, in any supported language. Matches the
 *  whole title, or the title's start followed by a separator ("Appendix A",
 *  "Notes: Chapter 3", "Danksagung und Dank"), never a word inside prose. */
export function matterFromTitle(title: string): MatterKind | null {
  const t = norm(title);
  if (!t) return null;
  for (const [name, m] of MATTER_LOOKUP) {
    if (t === name) return m;
    if (!t.startsWith(name)) continue;
    const next = t.slice(name.length);
    // "Also by Jane Austen", "Praise for Persuasion": the name always continues.
    if (m === MATTER.alsoBy && /^\s/u.test(next)) return m;
    // "Notes: Chapter 3", "Appendix A", "Anhang II", "Epilogue — Ten years on".
    if (/^\s*[:—–(,]/u.test(next) || /^\s+-\s/u.test(next) || /^\s+(?:[a-z]|\d{1,3}|[ivxlcdm]{1,5})$/u.test(next)) return m;
    // CJK names run straight into a subtitle; single characters are too
    // ambiguous ("跋涉" is a trek, not an afterword).
    if (/[぀-鿿]/u.test(name) && name.length >= 2 && next.length <= 20) return m;
  }
  return null;
}

/** A heading in any supported language: numbered, ordinal-first, CJK, or a
 *  front/back-matter name standing alone. */
export function isMultilingualHeading(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > 100) return false;
  if (NUMBERED.test(s) || ORDINAL_FIRST.test(s) || CJK_NUMBERED.test(s) || CJK_NAMED.test(s)) return true;
  // A matter name alone on its line ("Vorwort", "Remerciements"), short.
  return s.length <= 60 && !/[.!?,;]\s*\S/.test(s) && matterFromTitle(s) !== null && s.split(/\s+/).length <= 6;
}

/* ------------------------------------------------- language detection */

/** Frequent short words per language, chosen to separate close pairs
 *  (es/pt/it, de/nl). */
const STOPWORDS: Record<Exclude<Lang, "zh" | "ja" | "ru">, string[]> = {
  en: ["the", "and", "of", "to", "was", "he", "she", "that", "with", "had", "his", "her", "it", "you", "not", "for", "said", "which"],
  de: ["der", "die", "und", "das", "nicht", "ist", "ich", "sie", "es", "zu", "den", "mit", "sich", "auf", "ein", "eine", "dem", "war", "auch", "wie"],
  fr: ["le", "la", "les", "et", "des", "est", "que", "qui", "il", "elle", "pas", "une", "dans", "du", "ne", "je", "vous", "au", "avec", "était"],
  es: ["el", "la", "los", "las", "y", "que", "de", "en", "un", "una", "no", "se", "por", "con", "su", "del", "lo", "como", "pero", "muy"],
  it: ["il", "la", "che", "di", "e", "non", "un", "una", "per", "si", "gli", "del", "della", "con", "è", "le", "ma", "sono", "lo", "anche"],
  pt: ["o", "a", "os", "as", "que", "de", "não", "um", "uma", "em", "com", "se", "do", "da", "para", "é", "por", "mas", "ao", "você"],
  nl: ["de", "het", "een", "en", "van", "niet", "is", "dat", "ik", "je", "hij", "zij", "met", "op", "te", "zijn", "was", "maar", "voor", "ook"],
  pl: ["i", "w", "nie", "się", "na", "że", "z", "do", "to", "jest", "jak", "co", "ale", "o", "po", "tak", "jego", "był", "była", "już"],
};

const STOP_SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)])) as Record<
  keyof typeof STOPWORDS,
  Set<string>
>;

/**
 * Guess a text's language from its script and stopword frequency. Returns
 * null when the sample is too short or no language stands out. Reads at most
 * `sample` characters.
 */
export function detectLanguage(text: string, sample = 20_000): Lang | null {
  const s = text.slice(0, sample);
  const kana = (s.match(/[぀-ヿ]/gu) ?? []).length;
  const han = (s.match(/\p{Script=Han}/gu) ?? []).length;
  const cyrillic = (s.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (s.match(/\p{Script=Latin}/gu) ?? []).length;
  const letters = kana + han + cyrillic + latin;
  if (letters < 40) return null;
  if (kana / letters > 0.05) return "ja";
  if (han / letters > 0.3) return "zh";
  if (cyrillic / letters > 0.5) return "ru";
  const words = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 20) return null;
  const scores = (Object.keys(STOP_SETS) as (keyof typeof STOP_SETS)[]).map((lang) => {
    let hits = 0;
    for (const w of words) if (STOP_SETS[lang].has(w)) hits++;
    return { lang, score: hits / words.length };
  });
  // Polish letters are a strong tie-breaker against the other Latin scripts.
  if ((s.match(/[ąęłńśźż]/giu) ?? []).length > words.length * 0.02) {
    scores.find((x) => x.lang === "pl")!.score += 0.1;
  }
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < 0.08) return null;
  if (second && best.score < second.score * 1.2) return null;
  return best.lang;
}
