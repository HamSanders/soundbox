/** Step 1 — what do you want to make?
 *
 * The only question in the wizard that has no sensible default, which is why
 * it is first and why Next stays disabled until it is answered: every later
 * step is a consequence of it. */

import { AudioLinesIcon, MicIcon, MusicIcon } from "lucide-react";

import { SelectCard } from "@/components/onboarding/select-card";
import { INTENTS, INTENT_HINT, INTENT_LABEL, type Intent } from "@/lib/onboarding";

const ICON: Record<Intent, typeof AudioLinesIcon> = {
  sfx: AudioLinesIcon,
  music: MusicIcon,
  voice: MicIcon,
};

export function StepIntent({
  value,
  onChange,
}: {
  value: Intent[];
  onChange: (next: Intent[]) => void;
}) {
  const toggle = (intent: Intent) =>
    onChange(
      value.includes(intent) ? value.filter((i) => i !== intent) : [...value, intent],
    );

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Konchi runs 46 open-weight models on your own machine, and none of them
        are on your disk yet. Pick what you are here to make and we will install
        one model for each — you can add the rest later.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {INTENTS.map((intent) => (
          <SelectCard
            key={intent}
            selected={value.includes(intent)}
            onClick={() => toggle(intent)}
            icon={ICON[intent]}
            label={INTENT_LABEL[intent]}
            hint={INTENT_HINT[intent]}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">Pick as many as you like.</p>
    </div>
  );
}
