import { describe, expect, it } from "vitest";

import { detectLanguage, isMultilingualHeading, matterFromTitle } from "../src/audiobook/import/lang.js";
import { parsePlainText } from "../src/audiobook/import/plain.js";
import { classifySection, isHeadingLine, tidyTitle } from "../src/audiobook/import/text.js";
import { LANGUAGE_FIXTURES } from "./fixtures/audiobook/languages.js";
import { CH1, CH2 } from "./fixtures/audiobook/make.js";

describe("books in other languages", () => {
  for (const f of LANGUAGE_FIXTURES) {
    it(`${f.lang}: headings, section kinds and language`, () => {
      const m = parsePlainText(f.text);
      expect(m.sections.map((s) => s.title)).toEqual(f.titles);
      expect(m.sections.map((s) => [s.kind, s.included])).toEqual(f.kinds);
      expect(m.language).toBe(f.lang);
    });
  }

  it("detects English and refuses to guess on too little text", () => {
    expect(detectLanguage([...CH1, ...CH2].join(" "))).toBe("en");
    expect(detectLanguage("Hello there.")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });

  it("keeps metadata language over the guess", () => {
    const m = parsePlainText(`---\nlang: fr\n---\n\n# One\n\n${CH1.join("\n\n")}`, { markdown: true });
    expect(m.language).toBe("fr");
  });
});

describe("multilingual headings", () => {
  it("recognises numbered, ordinal-first and CJK headings", () => {
    for (const h of [
      "Kapitel 12", "KAPITEL ZWÖLF", "Drittes Kapitel", "Teil II", "Chapitre premier", "Livre III", "Capítulo 4",
      "Capitolo terzo", "Hoofdstuk 7", "Rozdział V", "Część pierwsza", "Глава 3", "ГЛАВА ПЕРВАЯ", "第十二章",
      "第3回", "第二部 春", "第一話", "Vorwort", "Épilogue", "Agradecimientos", "Послесловие", "あとがき",
    ]) {
      expect(isHeadingLine(h), h).toBe(true);
    }
  });

  it("doesn't take prose for a heading", () => {
    for (const t of [
      "Teil des Problems war, dass niemand zuhörte.",
      "Livre ouvert sur la table, il attendait.",
      "Parte de la culpa era suya, y lo sabía muy bien.",
      "第一个人走进了房间，看了看四周。",
      "Kapitel und Vers wurden zitiert, lang und breit, von einem Pfarrer, der alles schon gelesen hatte.",
    ]) {
      expect(isMultilingualHeading(t), t).toBe(false);
    }
  });

  it("matches matter names whole or with a qualifier, not inside a title", () => {
    expect(matterFromTitle("Anhang A")?.included).toBe(false);
    expect(matterFromTitle("Notes: Chapter 3")?.included).toBe(false);
    expect(matterFromTitle("Also by Jane Austen")?.included).toBe(false);
    expect(matterFromTitle("Notes from Underground")).toBeNull();
    expect(matterFromTitle("Index of Forbidden Things")).toBeNull();
    expect(matterFromTitle("跋涉")).toBeNull();
    expect(classifySection("Notes from Underground", ["Text."])).toEqual({ kind: "chapter", included: true });
    // Standard Ebooks ends every book with its "Uncopyright" dedication to the public domain.
    expect(classifySection("Uncopyright", ["May you do good and not evil."])).toEqual({ kind: "front_matter", included: false });
  });

  it("detects untitled copyright pages and dedications in other languages", () => {
    expect(classifySection("", ["Alle Rechte vorbehalten."]).included).toBe(false);
    expect(classifySection("", ["Все права защищены."]).included).toBe(false);
    expect(classifySection("", ["Für Anna"])).toEqual({ kind: "front_matter", included: true });
    expect(classifySection("", ["Pour mon père"])).toEqual({ kind: "front_matter", included: true });
  });

  it("title-cases all-caps headings in any script", () => {
    expect(tidyTitle("ГЛАВА ПЕРВАЯ")).toBe("Глава Первая");
    expect(tidyTitle("KAPITEL ZWÖLF")).toBe("Kapitel Zwölf");
    expect(tidyTitle("第一章")).toBe("第一章");
  });
});
