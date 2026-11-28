/**
 * Licence is the single most consequential fact about a model you are about to
 * put in a commercial project, so it gets a colour-coded badge rather than a
 * line of small print.
 */

import { ExternalLinkIcon } from "@/lib/icons";
import type { LicenseInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tone = { label: string; short: string; chip: string; panel: string };

/*
 * A rack label with a status LED, not a pill: the same three signal colours
 * (ok / warn / danger) as every other status in the app, so "green" means one
 * thing everywhere. Mono caps, because it is a fact you scan a column for, not
 * a sentence you read.
 */
const TONE: Record<LicenseInfo["commercial"], Tone> = {
  yes: {
    label: "Commercial OK",
    short: "Commercial OK",
    chip: "bg-ok/10 text-ok ring-ok/30",
    panel: "bg-ok/5 ring-ok/20",
  },
  conditional: {
    label: "Commercial: conditional",
    short: "Conditional",
    chip: "bg-warn/10 text-warn ring-warn/35",
    panel: "bg-warn/5 ring-warn/20",
  },
  no: {
    label: "Non-commercial only",
    short: "Non-commercial",
    chip: "bg-danger/10 text-danger ring-danger/35",
    panel: "bg-danger/5 ring-danger/20",
  },
};

export function LicenseChip({
  license,
  className,
}: {
  license: LicenseInfo;
  className?: string;
}) {
  const tone = TONE[license.commercial];
  return (
    <span
      className={cn(
        "label-caps inline-flex h-5 items-center gap-1.5 rounded-sm px-1.5 whitespace-nowrap ring-1 ring-inset",
        tone.chip,
        className,
      )}
      title={tone.label}
    >
      <span className="sb-led size-1.5" aria-hidden="true" />
      {/* Caps take room, so the label is the short word and the full
          sentence goes to assistive tech and the tooltip. */}
      <span aria-hidden="true">{tone.short}</span>
      <span className="sr-only">{tone.label}</span>
    </span>
  );
}

export function LicensePanel({ license }: { license: LicenseInfo }) {
  const tone = TONE[license.commercial];
  return (
    <div className={cn("rounded-lg px-3 py-2.5 ring-1 ring-inset", tone.panel)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <LicenseChip license={license} />
        <span className="text-foreground text-sm font-medium">{license.name}</span>
        {license.url && (
          <a
            href={license.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            Read the licence
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
        )}
      </div>
      {license.note && (
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
          {license.note}
        </p>
      )}
    </div>
  );
}
