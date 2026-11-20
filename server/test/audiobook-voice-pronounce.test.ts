/**
 * Audiobook pronunciation: rule matching, phoneme fallback, PLS/TXT round
 * trips, term suggestions, and the rules store on in-memory SQLite.
 */

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  affectedParagraphs,
  applyPronunciations,
  ipaToArpabet,
  parsePls,
  parseTxt,
  respell,
  suggestTerms,
  toPls,
  toTxt,
  type PHONEME_MARKUP,
} from "../src/audiobook/pronounce.js";
import { PronunciationStore } from "../src/audiobook/pronounce-store.js";
import type { PronunciationRule } from "../src/audiobook/types.js";

let n = 0;
function rule(p: Partial<PronunciationRule> & { term: string; replacement: string }): PronunciationRule {
  return {
    id: `r${n++}`,
    book_id: "b1",
    kind: "alias",
    case_sensitive: true,
    whole_word: true,
    position: n,
    ...p,
  };
}

describe("applyPronunciations", () => {
  it("replaces aliases, whole word and case-sensitive by default", () => {
    const r = applyPronunciations("Sam met Samwise. sam waved.", [rule({ term: "Sam", replacement: "Sahm" })], "audiocpp-kokoro");
    expect(r.text).toBe("Sahm met Samwise. sam waved.");
    expect(r.applied).toEqual([{ rule_id: expect.any(String), term: "Sam", count: 1, as: "alias" }]);
  });

  it("honours case-insensitive and substring rules", () => {
    const r = applyPronunciations(
      "SQL and sql; MySQL",
      [rule({ term: "sql", replacement: "sequel", case_sensitive: false, whole_word: false })],
      "m",
    );
    expect(r.text).toBe("sequel and sequel; Mysequel");
  });

  it("first match wins: an earlier rule's span is not touched by a later one", () => {
    const r = applyPronunciations(
      "New York City",
      [
        rule({ term: "New York", replacement: "Noo Yawk", position: 0 }),
        rule({ term: "York City", replacement: "WRONG", position: 1 }),
      ],
      "m",
    );
    expect(r.text).toBe("Noo Yawk City");
  });

  it("book rules beat global rules regardless of position", () => {
    const r = applyPronunciations(
      "Gif",
      [rule({ term: "Gif", replacement: "jif", book_id: null, position: 0 }), rule({ term: "Gif", replacement: "ghif", position: 5 })],
      "m",
    );
    expect(r.text).toBe("ghif");
  });

  it("skips empty rules", () => {
    expect(applyPronunciations("a b", [rule({ term: " ", replacement: "x" }), rule({ term: "a", replacement: "" })], "m").text).toBe("a b");
  });

  it("falls back from IPA to a later alias on a text-only model, with a warning", () => {
    const r = applyPronunciations(
      "Hermione smiled.",
      [
        rule({ term: "Hermione", kind: "ipa", replacement: "hɝˈmaɪəni", position: 0 }),
        rule({ term: "Hermione", replacement: "her-MY-oh-nee", position: 1 }),
      ],
      "audiocpp-kokoro",
    );
    expect(r.text).toBe("her-MY-oh-nee smiled.");
    expect(r.warnings[0]).toMatch(/kokoro reads plain text.*skipped/);
  });

  it("respells IPA/CMU when no alias exists", () => {
    const r = applyPronunciations("Hermione", [rule({ term: "Hermione", kind: "cmu", replacement: "HH ER0 M AY1 AH0 N IY0" })], "audiocpp-kokoro");
    expect(r.text).toBe("her-MY-uh-nee");
    expect(r.applied[0]!.as).toBe("respelling");
    expect(r.warnings[0]).toMatch(/respelling/);
  });

  it("passes phonemes through for a family that declares phoneme input", () => {
    const markup: typeof PHONEME_MARKUP = {
      fake: { kinds: ["ipa"], wrap: (t, p) => `[${t}](/${p}/)` },
    };
    const r = applyPronunciations("Hermione", [rule({ term: "Hermione", kind: "ipa", replacement: "hɝˈmaɪəni" })], "audiocpp-fake", markup);
    expect(r.text).toBe("[Hermione](/hɝˈmaɪəni/)");
    expect(r.warnings).toEqual([]);
  });
});

describe("respelling", () => {
  it("maps IPA to Arpabet with stress", () => {
    expect(ipaToArpabet("/ˈæpl̩/")).toEqual(["AE1", "P", "L"]);
    expect(ipaToArpabet("tʃeɪs")).toEqual(["CH", "EY0", "S"]);
  });
  it("capitalises the stressed syllable", () => {
    expect(respell("T AH0 M EY1 T OW0", "cmu")).toBe("tuh-MAY-toh");
    expect(respell("ˈkɒfi", "ipa")).toBe("KAH-fee");
  });
});

describe("PLS and TXT", () => {
  const pls = `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0" xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" alphabet="cmu-arpabet" xml:lang="en-GB">
  <lexeme><grapheme>apple</grapheme><phoneme>AE P AH L</phoneme></lexeme>
  <lexeme><grapheme>UN</grapheme><alias>United Nations</alias></lexeme>
  <lexeme><grapheme>Tomato</grapheme><grapheme>tomato</grapheme><phoneme alphabet="ipa">təˈmɑːtəʊ</phoneme></lexeme>
</lexicon>`;

  it("reads PLS lexicon and per-phoneme alphabets", () => {
    const { rules } = parsePls(pls);
    expect(rules.map((r) => [r.term, r.kind, r.replacement])).toEqual([
      ["apple", "cmu", "AE P AH L"],
      ["UN", "alias", "United Nations"],
      ["Tomato", "ipa", "təˈmɑːtəʊ"],
      ["tomato", "ipa", "təˈmɑːtəʊ"],
    ]);
  });

  it("round-trips through PLS and escapes XML", () => {
    const src = [
      { term: "AT&T", kind: "alias" as const, replacement: "A T and T" },
      { term: "apple", kind: "cmu" as const, replacement: "AE1 P AH0 L" },
      { term: "Hermione", kind: "ipa" as const, replacement: "hɝˈmaɪəni" },
    ];
    const xml = toPls(src);
    expect(xml).toContain('alphabet="ipa"');
    expect(xml).toContain('<phoneme alphabet="cmu-arpabet">');
    expect(parsePls(xml).rules.map((r) => ({ term: r.term, kind: r.kind, replacement: r.replacement }))).toEqual(src);
  });

  it("uses cmu-arpabet for an all-CMU lexicon", () => {
    expect(toPls([{ term: "a", kind: "cmu", replacement: "EY1" }])).toContain('alphabet="cmu-arpabet"');
  });

  it("rejects a file that is not a lexicon", () => {
    expect(() => parsePls("<html/>")).toThrow(/lexicon/);
  });

  it("round-trips TXT", () => {
    const txt = "# c\nHermione = her-MY-oh-nee\nKoffee\t/ˈkɒfi/\napple = {AE1 P AH0 L}\nbroken line\n";
    const { rules, warnings } = parseTxt(txt);
    expect(rules.map((r) => r.kind)).toEqual(["alias", "ipa", "cmu"]);
    expect(warnings).toHaveLength(1);
    expect(parseTxt(toTxt(rules)).rules).toEqual(rules);
  });
});

describe("suggestTerms", () => {
  it("finds repeated names and invented words, not ordinary capitals", () => {
    const paras = [
      "The ship left at dawn. Captain Vexhra watched as Tamsin climbed aboard.",
      "Tamsin said nothing. On Monday the Qaxl drive failed, and Vexhra swore.",
      "Then the crew ate.",
    ];
    const s = suggestTerms(paras);
    const terms = s.map((x) => x.term);
    expect(terms).toContain("Tamsin");
    expect(terms).toContain("Vexhra");
    expect(terms).toContain("Qaxl");
    expect(terms).not.toContain("Monday");
    expect(terms).not.toContain("Captain");
    expect(terms).not.toContain("Then");
    expect(s.find((x) => x.term === "Tamsin")!.example).toMatch(/Tamsin climbed aboard/);
  });

  it("leaves out terms that already have a rule", () => {
    expect(suggestTerms(["I saw Tamsin, and Tamsin saw me."], ["tamsin"])).toEqual([]);
  });
});

describe("affectedParagraphs", () => {
  it("lists paragraphs a rule matches", () => {
    const ids = affectedParagraphs(
      [{ id: "a", text: "Tamsin ran" }, { id: "b", text: "nobody" }],
      [rule({ term: "Tamsin", replacement: "x" })],
    );
    expect(ids).toEqual(["a"]);
  });
});

describe("PronunciationStore", () => {
  const conns: BetterSqlite3.Database[] = [];
  afterEach(() => conns.splice(0).forEach((c) => c.close()));

  it("keeps book and global rules apart and orders them", () => {
    const conn = new BetterSqlite3(":memory:");
    conns.push(conn);
    let i = 0;
    const store = new PronunciationStore(conn, () => `id${i++}`, () => "2026-01-01");
    const g = store.create(null, { term: "GIF", replacement: "jif" });
    const a = store.create("b1", { term: "Tamsin", replacement: "TAM-sin" });
    const b = store.create("b1", { term: "Vexhra", kind: "ipa", replacement: "ˈvɛksɹə", case_sensitive: false });
    expect(store.list("b1").map((r) => r.id)).toEqual([a.id, b.id]);
    expect(store.rulesFor("b1").map((r) => r.id)).toEqual([a.id, b.id, g.id]);
    expect(b.case_sensitive).toBe(false);
    store.reorder([b.id, a.id]);
    expect(store.list("b1").map((r) => r.id)).toEqual([b.id, a.id]);
    expect(store.update(a.id, { replacement: "TAM-zin" })!.replacement).toBe("TAM-zin");
    expect(store.delete(g.id)).toBe(true);
    expect(store.deleteBook("b1")).toBe(2);
    expect(store.rulesFor("b1")).toEqual([]);
  });
});
