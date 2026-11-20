/**
 * The Models page in Mirli on the web (hosted mode). There is no GPU and
 * nothing to download there: every render runs on Mirli Cloud. So the page is
 * the list of cloud models, what each makes, what a render costs, and the
 * balance it comes out of. The local page (packs, downloads, VRAM, the
 * prompt assistant) is `routes/models.tsx`.
 */

import { CloudIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ModelMark } from "@/components/model-shared";
import { Skeleton } from "@/components/ui/skeleton";
import type { CloudStatus, Model } from "@/lib/api";
import { cloudPriceLabel, creditsLabel } from "@/lib/cloud";
import { useModels } from "@/lib/queries";

const MAKES: Record<Model["category"], string> = {
  music: "Music",
  sfx: "Sound effects",
  voice: "Speech",
  utility: "Tools",
};

const ORDER: Model["category"][] = ["music", "sfx", "voice", "utility"];

export function CloudModelsPage({ cloud }: { cloud: CloudStatus }) {
  const { data: models, isLoading, isError, error } = useModels();
  const list = (models ?? [])
    .filter((m) => m.provider === "cloud")
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  const a = cloud.account;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Models</h1>
        <p className="text-muted-foreground text-sm">
          These run on Mirli Cloud. Each render costs credits, and a failed render is never charged.
        </p>
      </div>

      <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CloudIcon className="size-4" aria-hidden="true" />
            Your balance
          </p>
          <p className="text-muted-foreground text-xs">
            {a
              ? a.held > 0
                ? `${creditsLabel(a.held)} held for renders in progress`
                : `${creditsLabel(a.spent_today)} spent today`
              : (cloud.account_error ?? "Couldn't read the balance.")}
          </p>
        </div>
        {a && <p className="font-display text-2xl tabular-nums">{creditsLabel(a.balance)}</p>}
      </div>

      {isLoading ? (
        <div className="border-border overflow-hidden rounded-xl border">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="m-2 h-12 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState tone="error" title="Could not load models">
          {error instanceof Error ? error.message : "Unknown error"}
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState>Mirli Cloud has no models to offer right now.</EmptyState>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-xl border">
          <ul className="divide-border divide-y">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <ModelMark vendor={m.vendor} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-muted-foreground text-xs">
                    <span className="text-foreground/80">{MAKES[m.category]}</span>
                    {m.description && <> · {m.description}</>}
                  </p>
                </div>
                <p className="readout text-muted-foreground shrink-0 text-right text-xs">
                  {m.price ? cloudPriceLabel(m.price) : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
