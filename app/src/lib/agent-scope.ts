/**
 * What the assistant may act on, lent by the page that has it open.
 *
 * The studio lends its timeline through `studio-bridge.ts`; a book editor
 * lends this instead: which book and chapter are open and what is selected,
 * read fresh on each turn, plus names for the ids a proposal mentions so
 * the card can say "Ada" rather than a voice id. With a scope lent, the chat
 * sends its turns to the agent planner (`POST /api/agent/plan`), whose
 * vocabulary is the MCP toolkit.
 *
 * Null when no such page is open.
 */

import { create } from "zustand";

export interface AgentScope {
  bookId: string;
  chapterId: () => string | null;
  selectedIds: () => string[];
  /** A readable name for an id (a chapter, a voice, a character, a
   *  paragraph's first words), or undefined. */
  nameOf: (id: string) => string | undefined;
  /** Called after accepted calls ran, so the page can refetch. */
  changed: () => void;
}

interface AgentScopeState {
  scope: AgentScope | null;
  lend: (scope: AgentScope) => void;
  /** Only the lender may take it back. */
  reclaim: (bookId: string) => void;
}

export const useAgentScope = create<AgentScopeState>((set) => ({
  scope: null,
  lend: (scope) => set({ scope }),
  reclaim: (bookId) => set((s) => (s.scope?.bookId === bookId ? { scope: null } : {})),
}));
