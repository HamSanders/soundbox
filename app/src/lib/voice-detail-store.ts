/**
 * The voice whose details are open in the docked right-hand panel.
 *
 * The voice twin of `detail-store.ts`. It holds an id rather than a `Voice`,
 * so the panel follows the voice as the list refetches (a read bumps its
 * count, a clip changes its reference).
 *
 * The panel is rendered by the shell, not the Voice Lab, so that it sits in
 * the shell's row and the page narrows beside it. The actions that open the
 * Lab's own dialogs (Edit, Clips, the ··· menu) are registered here by the
 * Lab while it is mounted, and the panel calls them.
 */

import type { ReactNode } from "react";
import { create } from "zustand";

import { useDetailStore } from "@/lib/detail-store";
import type { Voice } from "@/lib/api";

export interface VoiceDetailActions {
  edit: (voice: Voice) => void;
  clips: (voice: Voice) => void;
  menu: (voice: Voice) => ReactNode;
}

interface VoiceDetailState {
  voiceId: string | null;
  actions: VoiceDetailActions | null;
  open: (voiceId: string) => void;
  close: () => void;
  setActions: (actions: VoiceDetailActions | null) => void;
}

export const useVoiceDetailStore = create<VoiceDetailState>((set) => ({
  voiceId: null,
  actions: null,
  open: (voiceId) => {
    // One docked panel at a time.
    useDetailStore.getState().close();
    set({ voiceId });
  },
  close: () => set({ voiceId: null }),
  setActions: (actions) => set({ actions }),
}));
