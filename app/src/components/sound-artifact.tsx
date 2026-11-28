/**
 * The selected clip's sample details, as a panel in the studio's stack.
 *
 * The same material as `/sounds/:id` — the waveform editor, the stems, and the
 * generation provenance — without leaving the arrangement to see it. Going to
 * the detail page in another tab to check what seed made a line, then coming
 * back to the timeline, is the trip this exists to remove.
 *
 * It reuses `SoundEditor` rather than drawing a second, smaller waveform:
 * every tool in it is non-destructive and writes a new derived clip, which is
 * exactly as true here as it is on the detail page. The provenance is laid out
 * two-up instead of as a full-width list, because a panel is wider than it is
 * tall and a single column of twelve facts would need scrolling that a grid
 * does not.
 */

import { Link } from "react-router-dom";
import { ExternalLinkIcon } from "@/lib/icons";

import { SoundEditor } from "@/components/sound-editor";
import { StemGroup } from "@/components/stem-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, formatHz, formatRelative } from "@/lib/format";
import { useModels } from "@/lib/queries";
import type { Sound } from "@/lib/api";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="border-border/60 flex items-baseline justify-between gap-3 border-b py-1.5 text-xs last:border-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function SoundArtifact({ sound }: { sound: Sound | null }) {
  const { data: models } = useModels();

  if (sound === null) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-center text-sm">
        Select a clip on the timeline to see the sample behind it — its waveform, its stems,
        and the prompt that made it.
      </div>
    );
  }

  const modelName = models?.find((m) => m.id === sound.model)?.name ?? sound.model;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {/* Keyed on the clip: the editor holds a WaveSurfer instance and a
          selection, and both belong to the sound that was on screen when they
          were made. */}
      <SoundEditor key={sound.id} sound={sound} />

      <StemGroup sourceId={sound.id} className="mt-3" />

      <div className="mt-4 flex items-center gap-2">
        <h3 className="text-sm font-medium">Generation details</h3>
        {modelName && (
          <Badge variant="secondary" className="text-[11px] font-normal">
            {modelName}
          </Badge>
        )}
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" asChild>
          <Link to={`/sounds/${sound.id}`}>
            Full page
            <ExternalLinkIcon className="size-3" />
          </Link>
        </Button>
      </div>

      <dl className="mt-1 grid gap-x-6 sm:grid-cols-2">
        <Fact label="Prompt" value={sound.prompt} />
        <Fact label="Negative" value={sound.negative_prompt} />
        <Fact label="Seed" value={sound.seed} />
        <Fact label="Steps" value={sound.steps} />
        <Fact label="CFG" value={sound.cfg} />
        <Fact label="Duration" value={formatDuration(sound.duration_s)} />
        <Fact
          label="Sample rate"
          value={`${formatHz(sound.sample_rate)} ${sound.channels === 2 ? "stereo" : "mono"}`}
        />
        <Fact label="File" value={formatBytes(sound.size_bytes)} />
        <Fact label="Created" value={formatRelative(sound.created_at)} />
        <Fact
          label="Source"
          value={sound.source === "mcp" ? (sound.client ?? "agent") : sound.source}
        />
      </dl>
    </div>
  );
}
