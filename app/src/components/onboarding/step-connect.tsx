/** The simple setup's last step: somewhere for renders to go.
 *
 * Every registered option (lib/setup-options.ts) shows its own panel; a
 * custom endpoint is always offered after them, since any server you run or
 * hosted API with your own key can be one. */

import { PlugIcon } from "@/lib/icons";

import { Button } from "@/components/ui/button";
import { setupOptions } from "@/lib/setup-options";

export function StepConnect({ onEndpoint }: { onEndpoint: () => void }) {
  const options = setupOptions();
  return (
    <div className="space-y-4">
      {options.map(({ id, Panel }) => (
        <div key={id} className="border-border rounded-lg border p-3">
          <Panel />
        </div>
      ))}
      <div className="border-border space-y-2 rounded-lg border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <PlugIcon className="size-4" aria-hidden="true" />
          {options.length ? "Or add an endpoint" : "Add an endpoint"}
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Point Mirli at a server you run, or at a hosted API such as ElevenLabs or fal with your own key. The
          provider bills you for each render. Your prompts go to that service.
        </p>
        <Button size="sm" variant="outline" onClick={onEndpoint}>
          Set up an endpoint
        </Button>
      </div>
    </div>
  );
}
