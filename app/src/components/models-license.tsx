/**
 * Licence display for the `/models` marketing pages.
 *
 * Why this exists next to `components/license-badge.tsx` rather than reusing
 * it: that component renders the app's `LicenseInfo`, whose `commercial` is
 * `"yes" | "conditional" | "no"` — three states, because the running app
 * always has *some* answer to show. Research has a fourth state. "Nobody here
 * has read a licence for these weights" is not "no", and rendering it as a red
 * non-commercial chip would be as wrong as rendering it green.
 *
 * So: same visual language and the same colour semantics, one extra state, and
 * a panel that always shows where the claim came from. See
 * `content/models/types.ts` for why "unknown" is load-bearing.
 */

import { AlertTriangleIcon, ExternalLinkIcon, HelpCircleIcon, ScaleIcon } from "lucide-react";

import type { CommercialUse, LicenseFinding } from "@/content/models/types";
import { cn } from "@/lib/utils";

type Tone = { label: string; short: string; chip: string; panel: string };

/** Colours deliberately match `license-badge.tsx` so a model looks the same in
 *  the app and on the site. Grey — not red — for unknown: red reads as "we
 *  checked and the answer is no", which is a claim we have not earned. */
const TONE: Record<CommercialUse, Tone> = {
  yes: {
    label: "Commercial use permitted",
    short: "Commercial OK",
    chip: "bg-ok/10 text-ok ring-ok/30",
    panel: "bg-ok/5 ring-ok/20",
  },
  conditional: {
    label: "Commercial use: conditions apply",
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
  unknown: {
    label: "Terms unconfirmed",
    short: "Unconfirmed",
    chip: "bg-muted text-muted-foreground ring-border/70",
    panel: "bg-muted/40 ring-border/60",
  },
};

const ICON: Record<CommercialUse, typeof ScaleIcon> = {
  yes: ScaleIcon,
  conditional: AlertTriangleIcon,
  no: AlertTriangleIcon,
  unknown: HelpCircleIcon,
};

export function ModelsLicenseChip({
  license,
  short = false,
  className,
}: {
  license: LicenseFinding;
  /** List rows are tight; the hub uses the short label and the detail page the
   *  full sentence. */
  short?: boolean;
  className?: string;
}) {
  const tone = TONE[license.commercial];
  const Icon = ICON[license.commercial];
  // The short form is a rack label (mono caps, an LED), the same object as
  // the app's licence badge; the long form is a sentence, so it stays one.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 whitespace-nowrap ring-1 ring-inset",
        short ? "label-caps" : "text-xs font-medium",
        tone.chip,
        className,
      )}
      title={short ? tone.label : undefined}
    >
      {short ? (
        <span
          className="sb-led size-1.5"
          data-off={license.commercial === "unknown" || undefined}
          aria-hidden="true"
        />
      ) : (
        <Icon className="size-3 shrink-0" aria-hidden="true" />
      )}
      {short ? tone.short : tone.label}
    </span>
  );
}

function SourceList({ sources }: { sources: LicenseFinding["sources"] }) {
  if (sources.length === 0) {
    // Not a rendering edge case so much as a content bug: the schema says
    // every finding is sourced. Say so rather than showing an empty <ul>.
    return (
      <p className="text-muted-foreground text-xs leading-relaxed">
        No source link exists for this entry — its terms have not been checked at all.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {sources.map((source) => (
        <li key={source.href}>
          <a
            href={source.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            {source.label}
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The full licence write-up for a detail page.
 *
 * Three things are kept visibly apart, because collapsing them is how licence
 * pages go wrong:
 *
 *   1. what the *weights* licence permits,
 *   2. what it says about the *audio you generate* — a different question,
 *      answered by a different clause, and frequently not answered at all,
 *   3. whether *we* actually read it, or are repeating someone else's label.
 */
export function ModelsLicensePanel({ license }: { license: LicenseFinding }) {
  const tone = TONE[license.commercial];
  return (
    <div className={cn("rounded-2xl p-5 ring-1 ring-inset", tone.panel)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-heading text-base font-semibold tracking-tight">{license.name}</h3>
        <ModelsLicenseChip license={license} />
      </div>

      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{license.summary}</p>

      {license.conditions.length > 0 && (
        <>
          <h4 className="label-caps text-foreground mt-4">
            Conditions
          </h4>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            {license.conditions.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
        </>
      )}

      <h4 className="label-caps text-foreground mt-4">
        What about the audio you generate?
      </h4>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{license.output}</p>

      {license.correction && (
        <p className="border-border/60 text-muted-foreground mt-4 border-l-2 pl-3 text-sm leading-relaxed">
          <span className="text-foreground font-medium">Correction to the shipped catalog: </span>
          {license.correction}
        </p>
      )}

      <div className="border-border/50 mt-4 border-t pt-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {license.readByUs
            ? "Based on the licence text as of the date below. Licences change; the links carry the authoritative version."
            : "This licence has not been reviewed in full — the label above is the one the model's publisher applies, repeated. Treat it as a pointer, not an answer."}
        </p>
        <div className="mt-2">
          <SourceList sources={license.sources} />
        </div>
      </div>
    </div>
  );
}
