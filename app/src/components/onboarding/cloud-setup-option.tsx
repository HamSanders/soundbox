/** Mirli Cloud as a place for renders to go in the simple setup
 * (lib/setup-options.ts). Offered only when the server has Mirli Cloud on;
 * the connect step shows its sign-in. */

import { CloudIcon } from "lucide-react";

import { CloudAccountPanel } from "@/components/cloud-settings";
import { useCloud } from "@/lib/queries";
import { registerSetupOption } from "@/lib/setup-options";

function CloudSetupPanel() {
  const { data: cloud } = useCloud();
  if (!cloud) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <CloudIcon className="size-4" aria-hidden="true" />
        Mirli Cloud
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Sign in in your browser, and the Mirli Cloud models in every picker run there. A render that fails is never
        charged.
      </p>
      <CloudAccountPanel status={cloud} />
    </div>
  );
}

/** Register the option once the server says Mirli Cloud is on. */
export function useCloudSetupOption(): void {
  const { data: cloud } = useCloud();
  if (cloud?.enabled) registerSetupOption({ id: "mirli-cloud", label: "Mirli Cloud", Panel: CloudSetupPanel });
}
