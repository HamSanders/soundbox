/**
 * Activity — a window into what the server is actually doing.
 *
 * The backend writes a rotating log under the data directory with every
 * job-related line tagged by job id. That file is the real diagnostic tool,
 * but reading it means knowing where it lives and having a terminal open —
 * so this surfaces the tail of it in the app, parsed rather than dumped.
 *
 * The reading itself is `components/log-tail`, shared with the studio's Logs
 * panel: level and source come out as filters, and the job id becomes a
 * first-class thing you can click to isolate one generation's whole story.
 * What is left here is the page around it — the heading, the desktop shell's
 * backend health, and the `?job=` link the History panel arrives with.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Loader2Icon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LogTail } from "@/components/log-tail";
import { getBackendHealth, isDesktop, restartBackend } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/** How often to poll backend health in the desktop shell. Cheap — a TCP
 *  connect plus one request — so this can run faster than the log tail. */
const HEALTH_POLL_MS = 5000;

/** Backend health, desktop-only: the web build has no process to restart, so
 *  there is nothing useful to show or do there. */
function BackendHealth() {
  const queryClient = useQueryClient();
  const { data: healthy, isLoading } = useQuery({
    queryKey: ["backend-health"],
    queryFn: getBackendHealth,
    refetchInterval: HEALTH_POLL_MS,
  });

  const restart = useMutation({
    mutationFn: restartBackend,
    onSuccess: () => {
      toast.success("Backend restarted");
      queryClient.invalidateQueries({ queryKey: ["backend-health"] });
    },
    onError: (error) =>
      toast.error("Could not restart the backend", {
        description: error instanceof Error ? error.message : "unknown error",
      }),
  });

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          isLoading ? "bg-muted-foreground/40" : healthy ? "bg-ok" : "bg-danger",
        )}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">
        Backend {isLoading ? "checking…" : healthy ? "running" : "not responding"}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => restart.mutate()}
        disabled={restart.isPending}
      >
        {restart.isPending ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
        Restart backend
      </Button>
    </div>
  );
}

export function ActivityPage() {
  // `/activity?job=…` is how the studio's History sends you here, so the
  // filter it asked for has to survive the navigation. Held in state after
  // that: clearing it should not need a second URL.
  const [params] = useSearchParams();
  const linked = params.get("job");
  const [jobFilter, setJobFilter] = useState<string | null>(linked);
  useEffect(() => {
    if (linked) setJobFilter(linked);
  }, [linked]);

  return (
    <div className="flex h-[calc(100svh-7rem)] flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-sm">
          The server&rsquo;s own log, newest last. Every generation tags its lines with a job
          id — click one to follow just that job.
        </p>
      </div>

      {isDesktop() && <BackendHealth />}

      <LogTail jobFilter={jobFilter} onJobFilter={setJobFilter} />
    </div>
  );
}
