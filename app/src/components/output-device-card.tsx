/**
 * Choosing where audio is played, and proving the choice works.
 *
 * This exists because a silent system default is indistinguishable from a
 * broken app: the browser resolves play(), the button flips to Pause, and the
 * clock sits at zero. The test tone measures whether playback actually
 * advanced, so the answer is "your output is dead", not "no sound happened".
 */

import { useEffect, useState } from "react";
import { PlayIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { playTestTone, useOutputStore } from "@/lib/audio-output";

const SYSTEM_DEFAULT = "__default__";

export function OutputDeviceCard() {
  const { sinkId, devices, labelsHidden, supported, setSinkId, refresh, requestLabels } =
    useOutputStore();
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refresh();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refresh]);

  const test = async () => {
    setTesting(true);
    try {
      const advanced = await playTestTone(sinkId);
      if (advanced > 0.1) {
        toast.success("Test tone played", {
          description: "This output works. If you heard nothing, check the volume.",
        });
      } else {
        toast.error("This output is not producing sound", {
          description:
            "Playback started but never advanced — the device accepted the audio and stopped. " +
            "This usually means a headset that is powered off or disconnected. Pick another output.",
        });
      }
    } catch (e) {
      toast.error("Could not play the test tone", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Playback device</CardTitle>
        <CardDescription>
          Where Konchi plays audio. This affects previews only — generated files are
          unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-muted-foreground text-sm">
            This browser can't choose an output device, so playback follows your system
            default. Chrome and Edge support it.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="output-device">Output</Label>
              <div className="flex gap-2">
                <Select
                  value={sinkId === "" ? SYSTEM_DEFAULT : sinkId}
                  onValueChange={(v) => setSinkId(v === SYSTEM_DEFAULT ? "" : v)}
                >
                  <SelectTrigger id="output-device" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
                    {devices
                      .filter((d) => d.deviceId && d.deviceId !== "default")
                      .map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void refresh()}
                  aria-label="Refresh device list"
                >
                  <RefreshCwIcon />
                </Button>
              </div>
            </div>

            {labelsHidden && (
              <p className="text-muted-foreground text-sm">
                Your browser hides device names until you grant a media permission once.{" "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-2"
                  onClick={() =>
                    void requestLabels().catch(() =>
                      toast.error("Permission denied — device names stay hidden"),
                    )
                  }
                >
                  Show device names
                </button>
                . Nothing is recorded; the microphone is released immediately.
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={test} disabled={testing}>
                <PlayIcon />
                {testing ? "Playing…" : "Play test tone"}
              </Button>
              <span className="text-muted-foreground text-xs">
                A 1-second tone. Confirms sound actually leaves this device.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
