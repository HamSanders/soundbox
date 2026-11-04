/** Step 4 — the two optional engines.
 *
 * The prompt assistant and the artwork model are the best parts of the app
 * that nobody discovers, because both are off by default and both live behind
 * a settings page. This step is the one moment they are cheap to explain: two
 * rows, what each actually gets you, what it costs to download, off unless
 * you say otherwise.
 *
 * Off by default here as well, deliberately. They are extra gigabytes on top
 * of an audio model someone is already waiting for, and defaulting them on
 * would make the first download twice as long for a feature they did not ask
 * for. Both are one switch away on Settings afterwards, which is what the
 * closing line says. */

import { ImageIcon, SparklesIcon } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/lib/format";
import type { ImageStatus, LlmStatus } from "@/lib/api";

function ExtraRow({
  icon: Icon,
  label,
  hint,
  size,
  installed,
  checked,
  onCheckedChange,
}: {
  icon: typeof SparklesIcon;
  label: string;
  hint: string;
  size: string | null;
  installed: boolean;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="border-border flex items-start gap-3 rounded-xl border p-4">
      <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs leading-snug">{hint}</p>
        <p className="text-muted-foreground text-xs">
          {installed ? "Already downloaded" : size ? `Downloads ${size}` : "Extra download"}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export function StepExtras({
  llm,
  image,
  assistant,
  artwork,
  onAssistant,
  onArtwork,
}: {
  llm: LlmStatus | undefined;
  image: ImageStatus | undefined;
  assistant: boolean;
  artwork: boolean;
  onAssistant: (on: boolean) => void;
  onArtwork: (on: boolean) => void;
}) {
  // The catalog's own recommendation, not a hardcoded id — the wizard should
  // not be the second place that has an opinion about which chat model is the
  // default one.
  const llmPick = llm?.catalog.find((m) => m.recommended) ?? llm?.catalog[0];
  const imagePick =
    image?.catalog.find((m) => m.id === "sd-turbo") ?? image?.catalog[0];

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Two things Konchi can do that need one more download each. Both are
        optional, and both run locally like everything else.
      </p>

      <ExtraRow
        icon={SparklesIcon}
        label="Prompt assistant"
        hint="Turns “scary sound” into the kind of prompt these models actually respond to, writes lyrics, and answers in the studio chat."
        size={llmPick ? formatBytes(llmPick.size_bytes) : null}
        installed={Boolean(llmPick?.installed)}
        checked={assistant}
        onCheckedChange={onAssistant}
      />

      <ExtraRow
        icon={ImageIcon}
        label="Artwork"
        hint="Cover art for the tracks you make and avatars for the voices you save, drawn by a small local image model."
        size={imagePick ? formatBytes(imagePick.size_bytes) : null}
        installed={Boolean(imagePick && imagePick.size_bytes === 0)}
        checked={artwork}
        onCheckedChange={onArtwork}
      />

      <p className="text-muted-foreground text-xs">
        You can turn either of these on later in Settings.
      </p>
    </div>
  );
}
