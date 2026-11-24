import { useQuery } from "@tanstack/react-query";

import { calls } from "./live-client";

export const callKeys = {
  status: ["calls", "status"] as const,
  characters: ["calls", "characters"] as const,
  character: (id: string) => ["calls", "characters", id] as const,
  voices: ["calls", "voices"] as const,
  history: ["calls", "history"] as const,
};

export const useCallStatus = () => useQuery({ queryKey: callKeys.status, queryFn: calls.status, refetchInterval: 10_000, retry: false });
export const useCharacters = () => useQuery({ queryKey: callKeys.characters, queryFn: calls.characters, retry: false });
export const useCallVoices = () => useQuery({ queryKey: callKeys.voices, queryFn: calls.voices, retry: false, staleTime: 60_000 });
export const useCallHistory = () => useQuery({ queryKey: callKeys.history, queryFn: calls.history, retry: false });

export const useCharacter = (id: string) =>
  useQuery({ queryKey: callKeys.character(id), queryFn: () => calls.character(id), retry: false, enabled: !!id });
