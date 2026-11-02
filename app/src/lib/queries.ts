/** react-query wiring: keys, reads, and mutations with toast-on-error. */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { forgetStoryDevices } from "@/hooks/use-track-devices";
import { followPlacement } from "@/lib/reading-order";
import {
  api,
  errorMessage,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantOpenersRequest,
  type AssistantOpenersResponse,
  type AudioCppCatalogEntry,
  type AudioEndpoint,
  type AudioEndpointInput,
  type EndpointList,
  type EndpointTestResult,
  type HistoryEntry,
  type NewHistoryEntry,
  type AudioCppRuntimeStatus,
  type EnhanceLyricsRequest,
  type EnhanceLyricsResponse,
  type EnhanceRequest,
  type EnhanceResponse,
  type Model,
  type GenerateRequest,
  type HealthStatus,
  type Job,
  type JobRef,
  type ImageStatus,
  type LlmStatus,
  type McpCallQuery,
  type McpStatus,
  type Profile,
  type ProfileList,
  type Project,
  type RepaintRequest,
  type SegmentCreate,
  type SegmentGenerate,
  type SegmentPatch,
  type Session,
  type Story,
  type StoryBuilder,
  type StorySegment,
  type StoryTrack,
  type TrackPatch,
  type DirectoryListing,
  type Settings,
  type SettingsPatch,
  type SkillInstallRequest,
  type Sound,
  type SoundEditRequest,
  type SoundPatch,
  type SoundQuery,
  type SoundsPage,
  type SpeakRequest,
  type StemSelection,
  type ConvertRequest,
  type TagCount,
  type Voice,
  type VoiceCreate,
  type VoicePatch,
} from "./api";

export const qk = {
  health: ["health"] as const,
  jobs: ["jobs"] as const,
  models: ["models"] as const,
  audiocppCatalog: ["audiocpp-catalog"] as const,
  audiocppRuntime: ["audiocpp-runtime"] as const,
  sounds: (query: SoundQuery) => ["sounds", query] as const,
  sound: (id: string) => ["sound", id] as const,
  tags: ["tags"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  projects: ["projects"] as const,
  stories: ["stories"] as const,
  story: (id: string) => ["story", id] as const,
  segments: (storyId: string) => ["story", storyId, "segments"] as const,
  tracks: (storyId: string) => ["story", storyId, "tracks"] as const,
  voices: ["voices"] as const,
  settings: ["settings"] as const,
  fsDirs: (path: string | null) => ["fs-dirs", path] as const,
  profiles: ["profiles"] as const,
  llmStatus: ["llm-status"] as const,
  conversations: ["conversations"] as const,
  storyConversation: (storyId: string) => ["conversation", "story", storyId] as const,
  historyEntries: (id: string) => ["conversation", id, "entries"] as const,
  imageStatus: ["image-status"] as const,
  endpoints: ["endpoints"] as const,
  mcpStatus: ["mcp-status"] as const,
  mcpCalls: (query: McpCallQuery) => ["mcp-calls", query] as const,
  assistantOpeners: (key: string) => ["assistant-openers", key] as const,
  /** Not a query: the key every write to one story's arrangement shares, so
   *  the cache can tell whether any of them are still in flight. */
  storyEdits: (storyId: string) => ["story-edit", storyId] as const,
};

/**
 * Refetch a story once, after the last of its in-flight edits settles.
 *
 * A group drag is five PATCHes and a reorder. Invalidating after each one
 * meant a refetch that started after the first write could land after it and
 * before the rest — and overwrite their optimistic positions, so clips
 * snapped back and then jumped forward again. Only the last edit to settle
 * refetches; the ones before it leave the optimistic cache alone. (During
 * `onSettled` the settling mutation still counts as in flight, hence 1.)
 */
function settleStory(qc: QueryClient, storyId: string, extra: readonly QueryKey[] = []): void {
  if (qc.isMutating({ mutationKey: qk.storyEdits(storyId) }) > 1) return;
  void qc.invalidateQueries({ queryKey: qk.story(storyId) });
  for (const key of extra) void qc.invalidateQueries({ queryKey: key });
}

export function useHealth(): UseQueryResult<HealthStatus> {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => api.getHealth(),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useModels(): UseQueryResult<Model[]> {
  return useQuery({
    queryKey: qk.models,
    queryFn: () => api.listModels(),
    // A per-row SSE subscription drives live progress while its component
    // stays mounted, but that subscription (and the jobId that starts it) is
    // lost on remount — e.g. switching tabs and back. Polling while anything
    // is downloading is the fallback that catches the row back up instead of
    // leaving it stuck showing "Not installed" until some other query
    // invalidates.
    refetchInterval: (query) =>
      query.state.data?.some((e) => e.status === "downloading") ? 2000 : false,
  });
}

/** Every model the audio.cpp adapter could run, verified or not — the
 *  Models page's "Enable more models" section reads this. */
export function useAudioCppCatalog(): UseQueryResult<AudioCppCatalogEntry[]> {
  return useQuery({
    queryKey: qk.audiocppCatalog,
    queryFn: () => api.listAudioCppCatalog(),
  });
}

/** Which audio.cpp binary resolved, how, and where its weights live. */
export function useAudioCppRuntime(): UseQueryResult<AudioCppRuntimeStatus> {
  return useQuery({
    queryKey: qk.audiocppRuntime,
    queryFn: () => api.getAudioCppRuntime(),
  });
}

/** Toggles one audio.cpp catalog id on or off. Takes the *current* catalog so
 *  it can compute the full enabled-ids list to send — the backend replaces
 *  the whole list on PATCH, it doesn't diff. */
export function useSetAudioCppEnabled() {
  const qc = useQueryClient();
  return useMutation<
    Settings,
    Error,
    { entry: AudioCppCatalogEntry; enabled: boolean; catalog: AudioCppCatalogEntry[] }
  >({
    mutationFn: ({ entry, enabled, catalog }) => {
      const current = new Set(
        catalog.filter((e) => !e.always_on && e.enabled).map((e) => e.id),
      );
      if (enabled) current.add(entry.id);
      else current.delete(entry.id);
      return api.updateSettings({ enabled_audiocpp_models: [...current] });
    },
    onError: fail("Could not update the model"),
    onSuccess: (next, { entry, enabled }) => {
      qc.setQueryData(qk.settings, next);
      void qc.invalidateQueries({ queryKey: qk.audiocppCatalog });
      void qc.invalidateQueries({ queryKey: qk.models });
      toast.success(enabled ? `${entry.name} enabled` : `${entry.name} disabled`);
    },
  });
}

/** Engine/model install state and the current mode. Per-row install progress
 *  comes from `useJobStream` the same way the Models page tracks audio.cpp
 *  downloads — the row invalidates this on job completion rather than this
 *  query polling. */
export function useLlmStatus(): UseQueryResult<LlmStatus> {
  return useQuery({ queryKey: qk.llmStatus, queryFn: () => api.getLlmStatus() });
}

/**
 * Whether the assistant can answer at all.
 *
 * Everything it does — a reply, a rewritten prompt, a plan for the timeline —
 * goes through the same endpoint, and with the mode off the server refuses
 * before it reads the question ("Prompt enhancement is off…"). So this is
 * the switch a chat surface asks before offering itself: a thread whose every
 * turn is the same error is worse than no thread.
 *
 * Optimistic while the status is still loading. Guessing "off" first would
 * take the panel off the screen and then put it back a moment later, and of
 * the two wrong guesses this is the one nobody sees.
 */
export function useAssistantEnabled(): boolean {
  const status = useLlmStatus();
  return status.data === undefined || status.data.mode !== "off";
}

/** No toast on error — the composer shows the failure inline (the message is
 *  almost always actionable: "off", "not downloaded yet", endpoint down). */
/**
 * What happened in this studio, and who caused it.
 *
 * Two queries rather than one: the conversation is found by story, then its
 * entries are fetched by id. Keeping them apart means appending an entry
 * invalidates the list without refetching the lookup, and a studio that has
 * never been talked to costs one request that returns null.
 */
export function useStoryConversation(storyId: string | null) {
  return useQuery({
    queryKey: qk.storyConversation(storyId ?? ""),
    queryFn: () => api.conversationForStory(storyId as string),
    enabled: Boolean(storyId),
  });
}

export function useHistoryEntries(conversationId: string | null) {
  return useQuery({
    queryKey: qk.historyEntries(conversationId ?? ""),
    queryFn: () => api.conversationEntries(conversationId as string),
    enabled: Boolean(conversationId),
  });
}

/**
 * Append to a studio's history, creating the conversation on first write.
 *
 * Lazy on purpose: a studio nobody has spoken in should not carry an empty
 * thread, and the first thing said is what names it. The caller does not have
 * to know whether one exists yet.
 */
export function useAppendHistory(storyId: string | null) {
  const qc = useQueryClient();
  return useMutation<HistoryEntry[], Error, NewHistoryEntry[]>({
    mutationFn: async (entries) => {
      if (!storyId) return [];
      let convo = await api.conversationForStory(storyId);
      if (!convo) convo = await api.createConversation(null, storyId);
      return api.appendHistory(convo.id, entries);
    },
    onSuccess: (_entries) => {
      void qc.invalidateQueries({ queryKey: qk.storyConversation(storyId ?? "") });
      void qc.invalidateQueries({ queryKey: qk.conversations });
      void qc.invalidateQueries({ queryKey: ["conversation"] });
    },
    // History is a record, not the work. A failed write must never surface as
    // a toast over the thing the person was actually doing.
    onError: () => {},
  });
}

export function useEnhance() {
  return useMutation<EnhanceResponse, Error, EnhanceRequest>({
    mutationFn: (req) => api.enhancePrompt(req),
  });
}

/** Writes a full lyric sheet — a different skill from `useEnhance` above, see
 *  `llm/enhance.ts`'s `buildLyricsMessages`. No toast, same reasoning as
 *  `useEnhance`: the failure is shown inline where the user is already looking. */
/** One assistant turn. No toast, same as `useEnhance`: the thread shows the
 *  failure where the reply would have been. */
export function useAssistantChat() {
  return useMutation<AssistantChatResponse, Error, AssistantChatRequest>({
    mutationFn: (req) => api.assistantChat(req),
  });
}

/** Fingerprint the arrangement, not the playhead — that ticks constantly. */
function openerStudioKey(studio: AssistantOpenersRequest["studio"]): string {
  if (!studio) return "";
  const tracks = studio.tracks
    .map((t) => `${t.track_index}:${t.name ?? ""}:${t.muted ? 1 : 0}:${t.soloed ? 1 : 0}`)
    .join("|");
  const labels = studio.clips.map((c) => c.label);
  return `${tracks}#${labels.length}:${labels.join("|")}`;
}

/** Empty-thread chips. No toast: the chat falls back to static openers. */
export function useAssistantOpeners(studio: AssistantOpenersRequest["studio"]) {
  return useQuery<AssistantOpenersResponse, Error>({
    queryKey: qk.assistantOpeners(openerStudioKey(studio)),
    queryFn: () => api.assistantOpeners({ studio: studio ?? null }),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnhanceLyrics() {
  return useMutation<EnhanceLyricsResponse, Error, EnhanceLyricsRequest>({
    mutationFn: (req) => api.enhanceLyrics(req),
  });
}

export function useLlmEngineInstall() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, void>({
    mutationFn: () => api.installLlmEngine(),
    onError: fail("Could not start the install"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.llmStatus }),
  });
}

export function useLlmModelDownload() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, string>({
    mutationFn: (id) => api.downloadLlmModel(id),
    onError: fail("Download failed to start"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.llmStatus }),
  });
}

export function useLlmModelDelete() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteLlmModel(id),
    onError: fail("Could not delete the weights"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.llmStatus }),
  });
}

/* ------------------------------------------------------------------ artwork */

export function useImageStatus(): UseQueryResult<ImageStatus> {
  return useQuery({ queryKey: qk.imageStatus, queryFn: () => api.getImageStatus() });
}

/* ---------------------------------------------------- custom endpoints */

export function useEndpoints(): UseQueryResult<EndpointList> {
  return useQuery({ queryKey: qk.endpoints, queryFn: () => api.listEndpoints() });
}

/** Saving or deleting an endpoint changes the model list too — each endpoint
 *  is a model — so both are refetched. */
export function useSaveEndpoint() {
  const qc = useQueryClient();
  return useMutation<AudioEndpoint, Error, { id: string; input: AudioEndpointInput }>({
    mutationFn: ({ id, input }) => api.saveEndpoint(id, input),
    onError: fail("Could not save the endpoint"),
    onSuccess: (saved) => {
      toast.success(`Saved ${saved.name}`);
      void qc.invalidateQueries({ queryKey: qk.endpoints });
      void qc.invalidateQueries({ queryKey: qk.models });
    },
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteEndpoint(id),
    onError: fail("Could not delete the endpoint"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.endpoints });
      void qc.invalidateQueries({ queryKey: qk.models });
    },
  });
}

/** No toast on error: the form shows the failure inline, next to the button
 *  that caused it, since reading it is the point of testing. */
export function useTestEndpoint() {
  return useMutation<
    EndpointTestResult,
    Error,
    AudioEndpointInput & { id?: string | null; prompt?: string | null }
  >({
    mutationFn: (input) => api.testEndpoint(input),
  });
}

export function useImageEngineInstall() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, void>({
    mutationFn: () => api.installImageEngine(),
    onError: fail("Could not start the install"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.imageStatus }),
  });
}

export function useImageModelDownload() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, string>({
    mutationFn: (id) => api.downloadImageModel(id),
    onError: fail("Download failed to start"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.imageStatus }),
  });
}

export function useImageModelDelete() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteImageModel(id),
    onError: fail("Could not delete the weights"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.imageStatus }),
  });
}

/**
 * Draw or clear a sound's cover art.
 *
 * Every sound list is invalidated on success rather than the one row patched:
 * a sound appears in the library, its detail page and any stem group, and a
 * cover that updated in one of those but not the others would look like a bug.
 */
export function useSoundArtwork() {
  const qc = useQueryClient();
  return useMutation<Sound, Error, string>({
    mutationFn: (id) => api.generateSoundArtwork(id),
    onError: fail("Could not draw the cover"),
    onSuccess: (sound) => {
      qc.setQueryData(qk.sound(sound.id), sound);
      void qc.invalidateQueries({ queryKey: ["sounds"] });
    },
  });
}

export function useVoiceArtwork() {
  const qc = useQueryClient();
  return useMutation<Voice, Error, string>({
    mutationFn: (id) => api.generateVoiceArtwork(id),
    onError: fail("Could not draw the avatar"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.voices }),
  });
}

export function useSounds(query: SoundQuery, enabled = true): UseQueryResult<SoundsPage> {
  return useQuery({
    queryKey: qk.sounds(query),
    queryFn: () => api.listSounds(query),
    enabled,
  });
}

export function useSound(id: string | null): UseQueryResult<Sound> {
  return useQuery({
    queryKey: qk.sound(id ?? ""),
    queryFn: () => api.getSound(id as string),
    enabled: Boolean(id),
  });
}

export function useTags(): UseQueryResult<TagCount[]> {
  return useQuery({ queryKey: qk.tags, queryFn: () => api.listTags() });
}

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings() });
}

/**
 * One folder's subfolders, for the "Browse…" pickers in Settings.
 *
 * `path` of null means "wherever the server calls home". Kept fresh for only a
 * moment — a folder listing is the sort of thing that changes underneath you,
 * and the picker is open for seconds at a time.
 */
export function useBrowseDirectories(
  path: string | null,
  enabled: boolean,
): UseQueryResult<DirectoryListing> {
  return useQuery({
    queryKey: qk.fsDirs(path),
    queryFn: () => api.browseDirectories(path),
    enabled,
    staleTime: 5_000,
  });
}

/** Connection details, connected agents and totals — the Agents page's main
 *  fetch. Polled: this is "who's active right now", not a one-shot read. */
export function useMcpStatus(): UseQueryResult<McpStatus> {
  return useQuery({
    queryKey: qk.mcpStatus,
    queryFn: () => api.getMcpStatus(),
    refetchInterval: 4000,
  });
}

export function useMcpCalls(query: McpCallQuery = {}) {
  return useQuery({
    queryKey: qk.mcpCalls(query),
    queryFn: () => api.listMcpCalls(query),
    refetchInterval: 3000,
  });
}

export function useInstallSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: SkillInstallRequest) => api.installSkills(req),
    onError: fail("Could not install skills"),
    onSuccess: (result) => {
      toast.success(`Installed ${result.installed.length} skill(s)`, {
        description: result.dest,
      });
      void qc.invalidateQueries({ queryKey: qk.mcpStatus });
    },
  });
}

/** Nothing fails silently — every mutation surfaces its error as a toast. */
function fail(action: string) {
  return (err: unknown) => toast.error(action, { description: errorMessage(err) });
}

export function useGenerate() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, GenerateRequest>({
    // Stamped here, once, rather than at every call site — the app is the
    // one caller that always knows what it is.
    mutationFn: (req) => api.generate({ origin: { source: "app" }, ...req }),
    onError: fail("Generation failed to start"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.health });
      // Wakes the queue indicator. `useJobs` only polls while it can see
      // something in flight, so without this the first submission after an
      // idle spell never shows up in it at all.
      void qc.invalidateQueries({ queryKey: qk.jobs });
      // A first generation creates a session server-side; Recent should show
      // it as soon as the job is queued, not once the audio lands minutes later.
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

/**
 * The job list, for the queue indicator.
 *
 * Polled rather than streamed: the per-job SSE in `useJobStream` follows one
 * job someone is watching, and the queue needs to know when a job it has never
 * seen appears — including ones queued from another surface, another window or
 * an MCP agent. Two seconds while anything is in flight, off entirely when the
 * queue is empty, so an idle app makes no requests for this at all.
 */
export function useJobs(limit = 50): UseQueryResult<Job[]> {
  return useQuery({
    queryKey: qk.jobs,
    queryFn: () => api.listJobs(limit),
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === "queued" || j.status === "running")
        ? 2000
        : false,
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onError: fail("Could not cancel the job"),
    // The queue list is polled, so without this a removed item sits there for
    // up to two seconds looking like the click missed.
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs }),
  });
}

export function useModelAction() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.models });
    void qc.invalidateQueries({ queryKey: qk.health });
  };

  const download = useMutation({
    mutationFn: (id: string) => api.downloadModel(id),
    onError: fail("Download failed to start"),
    onSuccess: invalidate,
  });
  const load = useMutation({
    mutationFn: (id: string) => api.loadModel(id),
    onError: fail("Could not load the model"),
    onSuccess: (model) => {
      toast.success(`${model.name} loaded`);
      invalidate();
    },
  });
  const unload = useMutation({
    mutationFn: (id: string) => api.unloadModel(id),
    onError: fail("Could not unload the model"),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteModelWeights(id),
    onError: fail("Could not delete the weights"),
    onSuccess: () => {
      toast.success("Weights deleted");
      invalidate();
    },
  });

  return { download, load, unload, remove };
}

export function useUpdateSound() {
  const qc = useQueryClient();
  return useMutation<Sound, Error, { id: string; patch: SoundPatch }>({
    mutationFn: ({ id, patch }) => api.updateSound(id, patch),
    onError: fail("Could not save the sound"),
    onSuccess: (sound, { patch }) => {
      void qc.invalidateQueries({ queryKey: ["sounds"] });
      void qc.invalidateQueries({ queryKey: qk.sound(sound.id) });
      void qc.invalidateQueries({ queryKey: qk.tags });
      // Moving a sound in/out of a project changes project sound_counts too.
      if ("project_id" in patch) void qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

/** Applies one non-destructive edit and returns the newly created derived
 *  sound — the source sound is never modified. */
export function useEditSound() {
  const qc = useQueryClient();
  return useMutation<Sound, Error, { id: string; req: SoundEditRequest }>({
    mutationFn: ({ id, req }) => api.editSound(id, req),
    onError: fail("Could not apply the edit"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sounds"] });
    },
  });
}

/**
 * Split a sound into stems. Async, unlike editSound — separation runs the
 * same audio.cpp subprocess path as generation, so it returns a job to poll
 * or subscribe to rather than the stems directly. The caller is responsible
 * for tracking the returned job and invalidating `["sounds"]` once it's done.
 */
/* ------------------------------------------------------------------ voices */

export function useVoices(): UseQueryResult<Voice[]> {
  return useQuery({ queryKey: qk.voices, queryFn: () => api.listVoices() });
}

export function useCreateVoice() {
  const qc = useQueryClient();
  return useMutation<Voice, Error, VoiceCreate>({
    mutationFn: (req) => api.createVoice(req),
    onError: fail("Could not save the voice"),
    onSuccess: (voice) => {
      toast.success(`Saved “${voice.name}”`);
      void qc.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useUploadVoice() {
  const qc = useQueryClient();
  return useMutation<
    Voice,
    Error,
    {
      name: string;
      file: Blob;
      notes?: string | null;
      modelId?: string | null;
      tidy?: boolean;
    }
  >({
    mutationFn: ({ name, file, notes, modelId, tidy }) =>
      api.uploadVoice(name, file, notes, modelId, tidy),
    onError: fail("Could not upload the reference clip"),
    onSuccess: (voice) => {
      toast.success(`Saved “${voice.name}”`);
      void qc.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useUpdateVoice() {
  const qc = useQueryClient();
  return useMutation<Voice, Error, { id: string; patch: VoicePatch }>({
    mutationFn: ({ id, patch }) => api.updateVoice(id, patch),
    onError: fail("Could not update the voice"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useDeleteVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteVoice(id),
    onError: fail("Could not delete the voice"),
    onSuccess: () => {
      toast.success("Voice deleted");
      void qc.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useAddVoiceSample() {
  const qc = useQueryClient();
  return useMutation<
    Voice,
    Error,
    {
      voiceId: string;
      source: { file: Blob } | { sourceSoundId: string };
      tidy?: boolean;
    }
  >({
    mutationFn: ({ voiceId, source, tidy }) => api.addVoiceSample(voiceId, source, tidy),
    onError: fail("Could not add the clip"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.voices }),
  });
}

export function useDeleteVoiceSample() {
  const qc = useQueryClient();
  return useMutation<Voice, Error, { voiceId: string; sampleId: string }>({
    mutationFn: ({ voiceId, sampleId }) => api.deleteVoiceSample(voiceId, sampleId),
    onError: fail("Could not remove the clip"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.voices }),
  });
}

/** Fetches the export and hands it to the browser as a file download — the
 *  same anchor trick `downloadSound` uses, since the JSON has to come through
 *  `request` (and the mock) rather than a bare link. */
export function useExportVoice() {
  return useMutation<void, Error, Voice>({
    mutationFn: async (voice) => {
      const file = await api.exportVoice(voice.id);
      const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${voice.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "voice"}.soundbox-voice.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    onError: fail("Could not export the voice"),
  });
}

export function useImportVoice() {
  const qc = useQueryClient();
  return useMutation<Voice, Error, File>({
    mutationFn: async (file) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't a Soundbox voice file.");
      }
      return api.importVoice(parsed);
    },
    onError: fail("Could not import the voice"),
    onSuccess: (voice) => {
      toast.success(`Imported “${voice.name}”`);
      void qc.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useSpeak() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, SpeakRequest>({
    mutationFn: (req) => api.speak({ origin: { source: "app" }, ...req }),
    onError: fail("Could not start the read"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.health });
      void qc.invalidateQueries({ queryKey: qk.jobs });
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

export function useConvertVoice() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, ConvertRequest>({
    mutationFn: (req) => api.convert({ origin: { source: "app" }, ...req }),
    onError: fail("Could not start the conversion"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.health });
      void qc.invalidateQueries({ queryKey: qk.jobs });
    },
  });
}

export function useSeparateSound() {
  const qc = useQueryClient();
  return useMutation<
    JobRef,
    Error,
    { modelId: string; sourceSoundId: string; stems?: StemSelection | null }
  >({
    mutationFn: ({ modelId, sourceSoundId, stems }) =>
      api.separateSound(modelId, sourceSoundId, stems ?? null),
    onError: fail("Could not start stem separation"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs }),
  });
}

export function useRepaintSound() {
  const qc = useQueryClient();
  return useMutation<JobRef, Error, RepaintRequest>({
    mutationFn: (req) => api.repaintSound({ origin: { source: "app" }, ...req }),
    onError: fail("Could not start the repaint"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.health });
    },
  });
}

export function useRevealSound() {
  return useMutation({
    mutationFn: (id: string) => api.revealSound(id),
    onError: fail("Could not open the file manager"),
  });
}

export function useSessions(limit = 50): UseQueryResult<Session[]> {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api.listSessions(limit) });
}

export function useSetSessionProject() {
  const qc = useQueryClient();
  return useMutation<Session, Error, { id: string; projectId: string | null }>({
    mutationFn: ({ id, projectId }) => api.setSessionProject(id, projectId),
    onError: fail("Could not update the session's project"),
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      void qc.invalidateQueries({ queryKey: qk.session(session.id) });
      void qc.invalidateQueries({ queryKey: qk.projects });
      // Every sound still inheriting from this session just changed project.
      void qc.invalidateQueries({ queryKey: ["sounds"] });
    },
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onError: fail("Could not delete the session"),
    onSuccess: () => {
      toast.success("Session deleted");
      // Its sounds went with it, so every sound-shaped view is stale too.
      void qc.invalidateQueries({ queryKey: qk.sessions });
      void qc.invalidateQueries({ queryKey: ["sounds"] });
      void qc.invalidateQueries({ queryKey: qk.tags });
    },
  });
}

/* ----------------------------------------------------------------- stories */

export function useStories(limit = 50): UseQueryResult<Story[]> {
  return useQuery({ queryKey: qk.stories, queryFn: () => api.listStories(limit) });
}

export function useStory(id: string | null): UseQueryResult<Story> {
  return useQuery({
    queryKey: qk.story(id ?? ""),
    queryFn: () => api.getStory(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateStory() {
  const qc = useQueryClient();
  return useMutation<
    Story,
    Error,
    { title?: string | null; projectId?: string | null; builder?: StoryBuilder } | void
  >({
    mutationFn: (args) =>
      api.createStory(args?.title ?? null, args?.projectId ?? null, args?.builder ?? "script"),
    onError: fail("Could not create the story"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.stories }),
  });
}

export function useRenameStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameStory(id, title),
    onError: fail("Could not rename the story"),
    onSuccess: (story) => {
      void qc.invalidateQueries({ queryKey: qk.stories });
      void qc.invalidateQueries({ queryKey: qk.story(story.id) });
    },
  });
}

/**
 * The story's default delivery.
 *
 * Optimistic on the story cache rather than waiting for the round trip: these
 * are sliders, and a slider that snaps back for 80ms on every drag reads as
 * broken. The invalidate that follows is what makes a rejected write visible.
 */
export function useSetStoryOptions() {
  const qc = useQueryClient();
  return useMutation<
    Story,
    Error,
    { id: string; options: Record<string, string> },
    { before?: Record<string, string> }
  >({
    mutationFn: ({ id, options }) => api.setStoryOptions(id, options),
    onMutate: async ({ id, options }) => {
      await qc.cancelQueries({ queryKey: qk.story(id), exact: true });
      const before = qc.getQueryData<Story>(qk.story(id))?.request_options;
      qc.setQueryData<Story>(qk.story(id), (prev) =>
        prev ? { ...prev, request_options: options } : prev,
      );
      return { before };
    },
    onError: (err, { id }, context) => {
      // A rejected write has to stop showing; the old value goes back.
      if (context?.before) {
        const before = context.before;
        qc.setQueryData<Story>(qk.story(id), (prev) =>
          prev ? { ...prev, request_options: before } : prev,
        );
      }
      fail("Could not save the delivery")(err);
    },
    onSettled: (_story, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.story(id), exact: true });
    },
  });
}

export function useDeleteStory() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; deleteSounds?: boolean }>({
    mutationFn: ({ id, deleteSounds }) => api.deleteStory(id, deleteSounds),
    onError: fail("Could not delete the story"),
    onSuccess: (_data, { id, deleteSounds }) => {
      toast.success("Story deleted");
      forgetStoryDevices(id);
      void qc.invalidateQueries({ queryKey: qk.stories });
      // Only the library-shaped views need refreshing when the audio went too.
      if (deleteSounds) {
        void qc.invalidateQueries({ queryKey: ["sounds"] });
        void qc.invalidateQueries({ queryKey: qk.tags });
      }
    },
  });
}

/* ---------------------------------------------------------------- segments */

export function useSegments(storyId: string | null): UseQueryResult<StorySegment[]> {
  return useQuery({
    queryKey: qk.segments(storyId ?? ""),
    queryFn: () => api.listSegments(storyId as string),
    enabled: Boolean(storyId),
  });
}

export function useCreateSegment(storyId: string) {
  const qc = useQueryClient();
  return useMutation<StorySegment, Error, SegmentCreate | void>({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: (req) => api.createSegment(storyId, req ?? {}),
    onError: fail("Could not add the line"),
    onSettled: () => settleStory(qc, storyId, [qk.stories]),
  });
}

/**
 * Edit a line, script side or timeline side.
 *
 * Optimistic because this is what dragging a clip commits: waiting for a round
 * trip before the clip moves would make the timeline feel like it is fighting
 * the pointer. The cache is patched in place and only reconciled on error.
 */
export function useUpdateSegment(storyId: string) {
  const qc = useQueryClient();
  const key = qk.segments(storyId);
  return useMutation<
    StorySegment,
    Error,
    { id: string; patch: SegmentPatch },
    { before?: Partial<StorySegment> }
  >({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: ({ id, patch }) => api.updateSegment(storyId, id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      // Only the fields this edit touched, on only this clip: restoring a
      // whole-list snapshot on failure would also undo every other edit that
      // started after it.
      const current = qc.getQueryData<StorySegment[]>(key)?.find((s) => s.id === id);
      const before = current
        ? (Object.fromEntries(
            Object.keys(patch).map((field) => [field, current[field as keyof StorySegment]]),
          ) as Partial<StorySegment>)
        : undefined;
      // A move re-reads the script, as the server is about to: the line
      // follows its clip in this frame rather than on the refetch.
      const moves =
        current !== undefined &&
        ((patch.start_s !== undefined && patch.start_s !== current.start_s) ||
          (patch.track_index !== undefined && patch.track_index !== current.track_index));
      qc.setQueryData<StorySegment[]>(key, (old) => {
        const next = old?.map((s) => (s.id === id ? { ...s, ...patch } : s));
        return next && moves ? followPlacement(next, id) : next;
      });
      return { before };
    },
    onError: (err, { id }, context) => {
      if (context?.before) {
        const before = context.before;
        qc.setQueryData<StorySegment[]>(key, (old) =>
          old?.map((s) => (s.id === id ? { ...s, ...before } : s)),
        );
      }
      fail("Could not update the line")(err);
    },
    onSettled: () => settleStory(qc, storyId),
  });
}

export function useDeleteSegment(storyId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: (segmentId) => api.deleteSegment(storyId, segmentId),
    onError: fail("Could not delete the line"),
    onSettled: () => settleStory(qc, storyId, [qk.stories]),
  });
}

/** Speak one line. Returns a job — the caller watches it with `useJobStream`
 *  and refreshes the segment list when it lands, same as the composer does. */
export function useGenerateSegment(storyId: string) {
  return useMutation<JobRef, Error, { id: string; req: SegmentGenerate }>({
    mutationFn: ({ id, req }) => api.generateSegment(storyId, id, req),
    onError: fail("Could not start the read"),
  });
}

export function useSplitSegment(storyId: string) {
  const qc = useQueryClient();
  return useMutation<StorySegment[], Error, { id: string; atS: number }>({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: ({ id, atS }) => api.splitSegment(storyId, id, atS),
    onError: fail("Could not split the clip"),
    // A split adds a line, so the story's own count moved too.
    onSettled: () => settleStory(qc, storyId, [qk.stories, ["sounds"]]),
  });
}

/** Open a library sound in the studio, optionally splitting it into stems
 *  first. The job's result carries the new story's id. */
export function useStoryFromSound() {
  const qc = useQueryClient();
  return useMutation<
    JobRef,
    Error,
    { soundId: string; separate?: boolean; stems?: StemSelection | null }
  >({
    mutationFn: ({ soundId, separate, stems }) =>
      api.storyFromSound(soundId, separate, stems ?? null),
    onError: fail("Could not open this in the studio"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.stories }),
  });
}

export function useTracks(storyId: string | null): UseQueryResult<StoryTrack[]> {
  return useQuery({
    queryKey: qk.tracks(storyId ?? ""),
    queryFn: () => api.listTracks(storyId as string),
    enabled: Boolean(storyId),
  });
}

/** Optimistic, like the segment edits: a mute button that waits for a round
 *  trip before it looks pressed reads as a broken button. */
export function useUpdateTrack(storyId: string) {
  const qc = useQueryClient();
  const key = qk.tracks(storyId);
  return useMutation<
    StoryTrack,
    Error,
    { trackIndex: number; patch: TrackPatch },
    { prev?: StoryTrack[] }
  >({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: ({ trackIndex, patch }) => api.updateTrack(storyId, trackIndex, patch),
    onMutate: async ({ trackIndex, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<StoryTrack[]>(key);
      qc.setQueryData<StoryTrack[]>(key, (old) => {
        const rows = old ?? [];
        const found = rows.find((t) => t.track_index === trackIndex);
        if (found) return rows.map((t) => (t.track_index === trackIndex ? { ...t, ...patch } : t));
        // A track with no row yet is at defaults — the optimistic row has to
        // stand in for one that does not exist server-side either.
        return [
          ...rows,
          {
            story_id: storyId, track_index: trackIndex,
            name: null, muted: false, soloed: false, gain_db: 0, devices: [],
            ...patch,
          },
        ];
      });
      return { prev };
    },
    onError: (err, _vars, context) => {
      if (context?.prev) qc.setQueryData(key, context.prev);
      fail("Could not update the track")(err);
    },
    onSettled: () => settleStory(qc, storyId),
  });
}

/** Removing a lane takes its clips, so both queries go stale. */
export function useDeleteTrack(storyId: string) {
  const qc = useQueryClient();
  return useMutation<{ removed_clips: number }, Error, number>({
    mutationKey: qk.storyEdits(storyId),
    mutationFn: (trackIndex) => api.deleteTrack(storyId, trackIndex),
    onError: fail("Could not remove the track"),
    onSuccess: ({ removed_clips }) => {
      if (removed_clips > 0) {
        toast.success(
          `Track removed with ${removed_clips} clip${removed_clips === 1 ? "" : "s"}`,
        );
      }
    },
    onSettled: () => settleStory(qc, storyId, [qk.stories]),
  });
}

export function useExportStory(storyId: string) {
  return useMutation<JobRef, Error, void>({
    mutationFn: () => api.exportStory(storyId),
    onError: fail("Could not start the export"),
  });
}

export function useDeleteSound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSound(id),
    onError: fail("Could not delete the sound"),
    onSuccess: () => {
      toast.success("Sound deleted");
      void qc.invalidateQueries({ queryKey: ["sounds"] });
      void qc.invalidateQueries({ queryKey: qk.tags });
    },
  });
}

export function useProjects(): UseQueryResult<Project[]> {
  return useQuery({ queryKey: qk.projects, queryFn: () => api.listProjects() });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<Project, Error, string>({
    mutationFn: (name) => api.createProject(name),
    onError: fail("Could not create the project"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onError: fail("Could not delete the project"),
    onSuccess: () => {
      toast.success("Project deleted");
      // Its sounds are only unfiled, not gone — but any view scoped to this
      // project (or showing project membership) is stale either way.
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: ["sounds"] });
    },
  });
}

/* --------------------------------------------------------------- profiles */

export function useProfiles(): UseQueryResult<ProfileList> {
  return useQuery({ queryKey: qk.profiles, queryFn: () => api.listProfiles() });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation<Profile, Error, string>({
    mutationFn: (name) => api.createProfile(name),
    onError: fail("Could not create the profile"),
    onSuccess: (profile) => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
      // Deliberately not a switch — see `createProfile` in the API client.
      toast.success(`Created ${profile.name}`);
    },
  });
}

export function useRenameProfile() {
  const qc = useQueryClient();
  return useMutation<Profile, Error, { id: string; name: string }>({
    mutationFn: ({ id, name }) => api.renameProfile(id, name),
    onError: fail("Could not rename the profile"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
    },
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; deleteData: boolean }>({
    mutationFn: ({ id, deleteData }) => api.deleteProfile(id, deleteData),
    onError: fail("Could not delete the profile"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
      toast.success("Profile deleted");
    },
  });
}

/**
 * Switch the server to another profile, then reload the page.
 *
 * A reload rather than a cache invalidation on purpose. Every library id in
 * the app — the open session, the story being edited, the sound in the player,
 * the SSE streams watching all three — belongs to the profile that was open,
 * and none of them exist in the new one. Clearing the query cache would leave
 * the Zustand stores and the audio element holding them anyway; a reload is
 * the one move that drops the lot, and on a local server it costs a blink.
 */
export function useActivateProfile() {
  return useMutation<ProfileList, Error, string>({
    mutationFn: (id) => api.activateProfile(id),
    onError: fail("Could not switch profile"),
    onSuccess: () => {
      // Land on the dashboard rather than reloading into, say, a story that
      // only existed in the profile we just left.
      window.location.hash = "#/dashboard";
      window.location.reload();
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation<Settings, Error, SettingsPatch>({
    mutationFn: (patch) => api.updateSettings(patch),
    onError: fail("Could not save settings"),
    onSuccess: (next) => {
      qc.setQueryData(qk.settings, next);
      toast.success("Settings saved");
    },
  });
}
