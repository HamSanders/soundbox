/**
 * Answers the home page and the search landing pages share, so they read the
 * same everywhere. Each is lifted from the README (the model table, the
 * hardware table) or from copy already on the site.
 */

export interface Faq {
  question: string;
  answer: string;
}

export const FREE: Faq = {
  question: "Is it really free?",
  answer:
    "The app is MIT licensed. There is no account and no credit meter. The model weights are separate: each carries its own licence, several forbid commercial use, and the licence is shown before you download one.",
};

export const GPU: Faq = {
  question: "Do I need a GPU?",
  answer:
    "A few GB of VRAM covers the verified models, and MiniMax Music 3 wants about 10 GB. With no dedicated GPU it still works, slowly: a clip that takes seconds on a GPU takes minutes on the CPU.",
};

export const OFFLINE: Faq = {
  question: "Does it work offline?",
  answer:
    "Yes, once the weights are downloaded. Generation runs on your machine and nothing is uploaded. The one request it makes on its own is a daily check for a newer version, which sends the version and the platform and nothing else. You can turn it off in Settings.",
};

export const COMMERCIAL: Faq = {
  question: "Can I use what it makes in a commercial project?",
  answer:
    "That is decided by the licence of the model that made the sound, not by the app. The Models page shows each licence before you download, and any model whose licence could not be established is treated as non-commercial. This is not legal advice: read the licence before you ship.",
};

export const MAC: Faq = {
  question: "Does it run on a Mac?",
  answer:
    "There are installers for Apple silicon and Intel Macs, and for Windows 10 and 11. None of the verified models has been confirmed on a Mac yet, so treat it as untested there. Linux runs from source.",
};

export const MODELS_FAQ: Faq = {
  question: "Which models does it run?",
  answer:
    "Four are verified end to end and on by default: Stable Audio 3.0 SFX, Stable Audio 3.0 Small Music, ACE-Step 1.5 Turbo and MiniMax Music 3. Dozens more can be switched on from the Models page, and each one's licence is shown before you download it.",
};

export const AGENT_FAQ: Faq = {
  question: "How do I connect Claude Code or Cursor?",
  answer:
    "Start the app, then run: claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp. Cursor and other MCP clients take the same URL. The agent gets 24 tools for sounds, speech and multi-track stories.",
};
