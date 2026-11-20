/**
 * Settings → Updates: the daily "is there a newer version?" check, with what
 * it sends written next to the switch.
 *
 * The wording is the disclosure. It says exactly what leaves the machine, what
 * the project does with it, and how to stop it, in the place a person looks
 * when they wonder whether the app talks to anyone.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCheckForUpdate, useSettings, useUpdateSettings, useUpdateStatus } from "@/lib/queries";
import { formatRelative } from "@/lib/format";

export function UpdateSettingsCard() {
  const { data: settings } = useSettings();
  const { data: status } = useUpdateStatus();
  const update = useUpdateSettings();
  const check = useCheckForUpdate();

  if (!settings) return null;
  const forcedOff = status?.disabled_by === "env";
  const host = status ? new URL(status.endpoint).host : "mirli.app";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Updates</CardTitle>
        <CardDescription>
          Mirli can ask once a day whether a newer version is out. It never downloads or
          installs anything by itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="update-check">Check for updates</Label>
            <p className="text-muted-foreground text-xs">
              {forcedOff
                ? "Turned off by MIRLI_UPDATE_CHECK=0 in this server's environment."
                : "On by default. Turn it off and Mirli sends nothing at all."}
            </p>
          </div>
          <Switch
            id="update-check"
            checked={settings.update_check && !forcedOff}
            disabled={forcedOff}
            onCheckedChange={(checked) => update.mutate({ update_check: checked })}
          />
        </div>

        <div className="text-muted-foreground space-y-2 border-t pt-4 text-xs leading-relaxed">
          <p>
            <span className="text-foreground font-medium">What it sends.</span> One request to{" "}
            <span className="font-mono">{host}</span> with two values: the version you are running
            ({status?.current ?? "…"}) and your platform, for example{" "}
            <span className="font-mono">win32-x64</span>. No account, no install ID, no cookies and
            nothing about your sounds, prompts or files.
          </p>
          <p>
            <span className="text-foreground font-medium">What the project keeps.</span> A count
            per day, per version and platform, which tells us roughly how many copies are running
            and which versions. As with any web request, the server can see your IP address; it is
            not stored. A restart does not send a second request the same day.
          </p>
        </div>

        {status?.enabled && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm">
              {status.available ? (
                <>
                  Mirli {status.latest} is available. You have {status.current}.{" "}
                  {status.url && (
                    <a
                      href={status.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-4"
                    >
                      See what changed
                    </a>
                  )}
                </>
              ) : status.latest ? (
                <>You are on the latest version ({status.current}).</>
              ) : (
                <span className="text-muted-foreground">
                  {status.error ? "The last check did not go through." : "Not checked yet."}
                </span>
              )}
              {status.checked_at && (
                <span className="text-muted-foreground">
                  {" "}
                  Checked {formatRelative(status.checked_at)}.
                </span>
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? "Checking…" : "Check now"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
