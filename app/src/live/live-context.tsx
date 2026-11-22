import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createLiveClient, defaultApiBase, type LiveClient } from "./lib/live-client";

const Ctx = createContext<LiveClient | null>(null);

export function LiveProvider({ baseUrl, children }: { baseUrl?: string; children: ReactNode }) {
  const client = useMemo(() => createLiveClient(baseUrl ?? defaultApiBase()), [baseUrl]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useLive(): LiveClient {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLive outside LiveProvider");
  return c;
}

export function useHealth() {
  const live = useLive();
  return useQuery({ queryKey: ["live", "health"], queryFn: live.health, refetchInterval: 10_000, retry: false });
}

export function useCharacters() {
  const live = useLive();
  return useQuery({ queryKey: ["live", "characters"], queryFn: live.characters, retry: false });
}

export function useVoices() {
  const live = useLive();
  return useQuery({ queryKey: ["live", "voices"], queryFn: live.voices, retry: false, staleTime: 60_000 });
}
