/**
 * The app-wide palette: ⌘K anywhere in the shell.
 *
 * It indexes what you would otherwise go looking for: recent sounds, the
 * stories, the voices, the models, the pages, and the profiles. Settings rows
 * are in the index too but stay out of the default list until something is
 * typed, so the first screen is the things you jump to, not a settings menu.
 * The first row is contextual: Generate when a page with a composer is
 * showing and the box has words in it, Cancel while a job runs.
 *
 * Anything that acts on the open document belongs to that page's own
 * palette instead. The list component is `command-palette.tsx`, which knows
 * how to choose a command and nothing about what any of them do.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { CommandPalette, type Command } from "@/components/command-palette";
import { KeyboardCheatsheet } from "@/components/keyboard-cheatsheet";
import { NewStudioDialog } from "@/components/new-studio-dialog";
import { ProfileManagerDialog } from "@/components/profile-manager";
import { GENERATE_EVENT } from "@/hooks/use-generate-session";
import {
  useActivateProfile,
  useCancelJob,
  useModelAction,
  useModels,
  useProfiles,
  useSounds,
  useStories,
  useVoices,
} from "@/lib/queries";
import { MOD } from "@/lib/platform";
import { useSessionStore } from "@/lib/session-store";
import type { Model, Profile } from "@/lib/api";
import { useAudiobookCommands } from "@/components/audiobook/shelf/use-audiobook-commands"; // [audiobooks:core]

const NO_PROFILES: Profile[] = [];

const PAGES: { label: string; to: string }[] = [
  { label: "Go to Dashboard", to: "/dashboard" },
  { label: "Go to Generate", to: "/chat" },
  { label: "Go to Console", to: "/console" },
  { label: "Go to Library", to: "/library" },
  { label: "Go to SFX", to: "/library/sfx" },
  { label: "Go to Music", to: "/library/music" },
  { label: "Go to Text to Speech", to: "/library/speech" },
  { label: "Go to Studio", to: "/studio" },
  { label: "Go to Voice Lab", to: "/voice/lab" },
  { label: "Go to Projects", to: "/projects" },
  { label: "Go to Models", to: "/models" },
  { label: "Go to Agents", to: "/agents" },
  { label: "Go to Activity", to: "/activity" },
  { label: "Go to Settings", to: "/settings" },
];

/** Settings rows, by the words people search for. Each lands on its section
 *  of the one Settings page. Hidden until typed: see the file comment. */
const SETTINGS: { label: string; section: string; keywords: string }[] = [
  { label: "Output format", section: "audio", keywords: "wav mp3 output device" },
  { label: "Loudness and silence", section: "audio", keywords: "normalise lufs trim silence" },
  { label: "Prompt assistant", section: "generation", keywords: "llm assistant enhance rewrite ollama" },
  { label: "Device and auto-unload", section: "generation", keywords: "cuda cpu gpu unload minutes vram idle" },
  { label: "Artwork", section: "generation", keywords: "cover art image thumbnails" },
  { label: "Endpoints", section: "endpoints", keywords: "remote audio.cpp custom endpoint api key" },
  { label: "Storage and folders", section: "storage", keywords: "data directory models folder sounds folder disk path" },
  { label: "Hugging Face token", section: "accounts", keywords: "hf token gated accounts" },
  { label: "MCP telemetry", section: "advanced", keywords: "otel opentelemetry collector traces advanced" },
];

/** Pages whose composer is the one `GENERATE_EVENT` reaches. */
function hasComposer(pathname: string): boolean {
  return pathname === "/library/sfx" || pathname === "/library/speech" || pathname === "/console";
}

/**
 * Both builders have a palette of their own, over a page with eight
 * toggleable panels, and they took ⌘K first. Two palettes on one key would
 * open together, so this one stands down while a builder is in front — the
 * header chip is still there for switching profile, which is the part you
 * would miss.
 */
function pageOwnsTheKey(pathname: string): boolean {
  // Settings uses Ctrl/Cmd+K for its own search box.
  return pathname.startsWith("/studio/") || pathname === "/settings";
}

/** What the row for a model offers, by its state. Null when nothing applies
 *  (downloading, or a state the palette should not poke). */
function modelVerb(model: Model): "Load" | "Unload" | null {
  switch (model.status) {
    case "loaded":
      return "Unload";
    case "installed":
      return "Load";
    default:
      return null;
  }
}

export function AppCommandPalette() {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data } = useProfiles();
  const activate = useActivateProfile();
  // The sound index is only fetched once the palette has been opened; until
  // then the page's own queries are the ones that should have the network.
  const [everOpened, setEverOpened] = useState(false);
  const { data: sounds } = useSounds({ limit: 25 }, everOpened);
  const { data: stories } = useStories(50);
  const audiobookRows = useAudiobookCommands(everOpened); // [audiobooks:core]
  const { data: voices } = useVoices();
  const { data: models } = useModels();
  const modelAction = useModelAction();
  const cancel = useCancelJob();
  const prompt = useSessionStore((s) => s.settings.prompt);
  const jobId = useSessionStore((s) => s.jobId);
  const running = useSessionStore((s) =>
    Boolean(s.jobId && s.turns.some((t) => t.jobId === s.jobId && t.status === "pending")),
  );
  // A stable empty array, so the memo below is not rebuilt on every render
  // before the first fetch lands.
  const profiles = data?.profiles ?? NO_PROFILES;
  const standDown = pageOwnsTheKey(pathname);

  useEffect(() => {
    if (standDown) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      // Firefox and Chrome both give ⌘K to the address bar otherwise.
      event.preventDefault();
      setEverOpened(true);
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [standDown]);

  const goToSettings = useCallback(
    (section: string) => {
      navigate("/settings");
      // The page mounts on the next frame; the section is scrolled to once
      // it exists, the same way the Settings nav does it.
      window.setTimeout(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: "smooth" });
      }, 120);
    },
    [navigate],
  );

  const commands = useMemo<Command[]>(() => {
    const contextual: Command[] = [];
    if (hasComposer(pathname)) {
      if (running && jobId) {
        contextual.push({
          id: "job:cancel",
          label: "Cancel the running job",
          detail: "Stops the last generation you started",
          run: () => cancel.mutate(jobId),
        });
      }
      const words = prompt.trim();
      contextual.push({
        id: "composer:generate",
        label: "Generate",
        detail: words ? `“${words.slice(0, 60)}${words.length > 60 ? "…" : ""}”` : "Nothing in the box yet",
        hint: ["mod", "Enter"],
        disabled: !words,
        run: () => window.dispatchEvent(new Event(GENERATE_EVENT)),
      });
    }

    // Profiles: the one command here with a consequence, and the list is
    // short. A single-profile install shows nothing but "New profile…",
    // which is also how you find out the feature exists.
    const switching: Command[] = profiles.map((profile) => ({
      id: `profile:${profile.id}`,
      label: `Open ${profile.name}`,
      group: "Profiles",
      active: profile.active,
      // Shown and refused rather than hidden — a missing row reads as a bug
      // where a checked one reads as an answer.
      disabled: profile.active || activate.isPending,
      run: () => activate.mutate(profile.id),
    }));

    const soundRows: Command[] = (sounds?.items ?? []).map((sound) => ({
      id: `sound:${sound.id}`,
      label: sound.name,
      detail: sound.prompt,
      keywords: `${sound.model} ${sound.tags.join(" ")}`,
      group: "Sounds",
      run: () => navigate(`/sounds/${sound.id}`),
    }));

    const storyRows: Command[] = (stories ?? []).map((story) => ({
      id: `story:${story.id}`,
      label: story.title,
      detail: story.builder === "music" ? "Music Builder" : "Script Builder",
      keywords: "story studio",
      group: "Stories",
      run: () => navigate(`/studio/${story.builder}/${story.id}`),
    }));

    const voiceRows: Command[] = (voices ?? []).map((voice) => ({
      id: `voice:${voice.id}`,
      label: voice.name,
      detail: voice.kind === "clone" ? "Cloned voice · Voice Lab" : "Built-in voice · Voice Lab",
      keywords: "voice speak",
      group: "Voices",
      run: () => navigate("/voice/lab"),
    }));

    const modelRows: Command[] = (models ?? []).map((model) => {
      const verb = modelVerb(model);
      return {
        id: `model:${model.id}`,
        // Downloading is not offered from here: a non-commercial model asks
        // for a licence acknowledgement first, and that lives on Models.
        label: verb ? `${verb} ${model.name}` : model.name,
        detail:
          model.status === "not_installed"
            ? "Not installed · open in Models to download"
            : verb === "Unload"
              ? "Frees its VRAM"
              : verb === "Load"
                ? "Loads it into memory now"
                : "Open in Models",
        keywords: `model ${model.category} ${model.status}`,
        group: "Models",
        disabled: modelAction.load.isPending || modelAction.unload.isPending,
        run: () => {
          if (verb === "Load") modelAction.load.mutate(model.id);
          else if (verb === "Unload") modelAction.unload.mutate(model.id);
          else navigate("/models");
        },
      };
    });

    const settingRows: Command[] = SETTINGS.map((row) => ({
      id: `settings:${row.section}:${row.label}`,
      label: row.label,
      detail: "Settings",
      keywords: `settings ${row.keywords}`,
      group: "Settings",
      hidden: true,
      run: () => goToSettings(row.section),
    }));

    return [
      ...contextual,
      // The same door as the sidebar's and the dashboard's: which builder
      // this is for is a question, not an assumption.
      { id: "studio:new", label: "New sound…", run: () => setPickerOpen(true) },
      { id: "keys", label: "Keyboard shortcuts", hint: ["?"], run: () => setKeysOpen(true) },
      ...switching,
      { id: "profile:new", label: "New profile…", group: "Profiles", run: () => setManageOpen(true) },
      ...PAGES.map((page) => ({
        id: `go:${page.to}`,
        label: page.label,
        group: "Pages",
        active: pathname === page.to,
        run: () => navigate(page.to),
      })),
      ...soundRows,
      ...storyRows,
      ...audiobookRows, // [audiobooks:core]
      ...voiceRows,
      ...modelRows,
      ...settingRows,
    ];
  }, [
    pathname,
    running,
    jobId,
    prompt,
    cancel,
    profiles,
    activate,
    sounds,
    stories,
    audiobookRows, // [audiobooks:core]
    voices,
    models,
    modelAction,
    navigate,
    goToSettings,
  ]);

  return (
    <>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        commands={commands}
        placeholder={`Sounds, stories, voices, models, pages…  (${MOD === "⌘" ? "⌘" : "Ctrl+"}K)`}
      />
      <ProfileManagerDialog open={manageOpen} onOpenChange={setManageOpen} profiles={profiles} />
      <NewStudioDialog open={pickerOpen} onOpenChange={setPickerOpen} />
      <KeyboardCheatsheet open={keysOpen} onOpenChange={setKeysOpen} />
    </>
  );
}
