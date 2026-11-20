import { describe, expect, it } from "vitest";

import { dashDialogueToQuotes, normaliseDialogue, normaliseQuotes } from "../src/audiobook/import/dialogue.js";
import { cleanParagraphs } from "../src/audiobook/import/text.js";

describe("dialogue punctuation", () => {
  it("turns em-dash dialogue into quoted speech", () => {
    // Russian convention: spaced em dashes.
    expect(dashDialogueToQuotes("— Ты пришёл? — спросила она.")).toBe("“Ты пришёл?” спросила она.");
    // Spanish convention: dashes hug the narration, punctuation after the closing dash.
    expect(dashDialogueToQuotes("—¿Vienes? —preguntó ella—. Hoy no.")).toBe("“¿Vienes?” preguntó ella. “Hoy no.”");
    // French, with an en dash used as the dialogue dash.
    expect(dashDialogueToQuotes("– Bonjour, dit-il.")).toBe("“Bonjour, dit-il.”");
    expect(dashDialogueToQuotes("— Да.")).toBe("“Да.”");
  });

  it("leaves dashes alone outside dialogue paragraphs and attributions", () => {
    expect(dashDialogueToQuotes("She paused — then left.")).toBe("She paused — then left.");
    expect(dashDialogueToQuotes("— Jane Austen, Persuasion")).toBe("— Jane Austen, Persuasion");
    expect(dashDialogueToQuotes("well-known — and loved")).toBe("well-known — and loved");
  });

  it("normalises guillemets and low quotes to curly quotes", () => {
    expect(normaliseQuotes("« Bonjour », dit-il.", "fr")).toBe("“Bonjour”, dit-il.");
    expect(normaliseQuotes("»Hallo«, sagte sie.", "de")).toBe("“Hallo”, sagte sie.");
    expect(normaliseQuotes("„Hallo“, sagte sie.")).toBe("“Hallo”, sagte sie.");
    expect(normaliseQuotes("„Dzień dobry” – powiedział.")).toBe("“Dzień dobry” – powiedział.");
    expect(normaliseQuotes("‚Ja‘, sagte er.")).toBe("‘Ja’, sagte er.");
    expect(normaliseQuotes("“Already curly,” she said.")).toBe("“Already curly,” she said.");
  });

  it("picks the guillemet direction from the batch", () => {
    expect(normaliseDialogue(["»Komm«, sagte er.", "»Gleich«"])).toEqual(["“Komm”, sagte er.", "“Gleich”"]);
    expect(normaliseDialogue(["« Viens », dit-il.", "« Tout de suite. »"])).toEqual(["“Viens”, dit-il.", "“Tout de suite.”"]);
  });

  it("cleanParagraphs applies it by default and can skip it", () => {
    expect(cleanParagraphs(["— Да, — сказал он."])).toEqual(["“Да,” сказал он."]);
    expect(cleanParagraphs(["— Да, — сказал он."], { dialogue: false })).toEqual(["— Да, — сказал он."]);
  });
});
