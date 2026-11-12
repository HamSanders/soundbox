/**
 * The site's two download controls, both fed by `useInstallers`.
 *
 * `DownloadButton` is the one above the fold: it names the visitor's system
 * and links straight to that installer. `PlatformPicker` is the one further
 * down: every installer side by side, with the detected one marked, for a
 * wrong guess or for someone downloading for another machine.
 *
 * Before the lookup lands, and for a visitor on a phone or Linux, the button
 * reads "Download" and goes to `/download`, so it is never a dead link.
 */

import { ArrowDownIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  LATEST_RELEASE_URL,
  megabytes,
  PLATFORMS,
  useInstallers,
} from "@/lib/installers";
import { REPO_URL } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

export function DownloadButton({
  pickerHref,
  className,
}: {
  /** Where "other platforms" goes: the picker on this page, or `/download`. */
  pickerHref: string;
  className?: string;
}) {
  const { release, primary, primaryAsset } = useInstallers();
  const direct = primary && primaryAsset;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <Button size="lg" asChild>
        {direct ? (
          <a href={primaryAsset.browser_download_url}>
            <ArrowDownIcon aria-hidden="true" />
            Download for {primary.short}
          </a>
        ) : (
          <Link to="/download">
            <ArrowDownIcon aria-hidden="true" />
            Download
          </Link>
        )}
      </Button>
      <p className="text-muted-foreground text-xs">
        {direct
          ? `${release?.tag_name} · ${megabytes(primaryAsset.size)} MB · `
          : "Windows and macOS · "}
        <a href={pickerHref} className="hover:text-foreground underline underline-offset-4">
          {direct ? "other platforms" : "pick a platform"}
        </a>
      </p>
    </div>
  );
}

export function PlatformPicker({ className }: { className?: string }) {
  const { mine, assetFor } = useInstallers();

  return (
    <div className={className}>
      <ul className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const asset = assetFor(platform);
          const isMine = platform.id === mine;
          return (
            <li
              key={platform.id}
              className={cn(
                "flex flex-col rounded-md border p-4",
                isMine ? "border-foreground bg-card" : "border-border",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-heading font-semibold tracking-tight">{platform.label}</h3>
                {isMine ? (
                  <span className="label-caps text-foreground">Your system</span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{platform.detail}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="readout text-muted-foreground text-xs">
                  {asset ? `${megabytes(asset.size)} MB` : " "}
                </span>
                <Button size="sm" variant={isMine ? "default" : "outline"} asChild>
                  <a
                    href={asset?.browser_download_url ?? LATEST_RELEASE_URL}
                    aria-label={`Download for ${platform.label}`}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                    Download
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs">
        On Linux,{" "}
        <a className="underline underline-offset-4" href={`${REPO_URL}#run-from-source`}>
          run it from source
        </a>
        . Older builds are on the{" "}
        <a className="underline underline-offset-4" href={`${REPO_URL}/releases`}>
          releases page
        </a>
        .
      </p>
    </div>
  );
}
