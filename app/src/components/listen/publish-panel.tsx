/**
 * Publish and share: a readiness checklist per distribution route, and the
 * two exports this area makes (a self-contained web player, a podcast feed).
 * Mirli does not upload anywhere; the exports land in the data folder.
 */

import { useState } from "react";
import { CheckCircle2Icon, CircleAlertIcon, CircleIcon, DownloadIcon, GlobeIcon, RssIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChecklist, usePublishRss, usePublishWebPlayer } from "@/lib/listen-queries";
import type { ChecklistTarget, PublishResult } from "@/lib/listen-types";
import { cn } from "@/lib/utils";

function TargetRow({ target }: { target: ChecklistTarget }) {
  const required = target.items.filter((i) => i.level === "required");
  const passed = required.filter((i) => i.pass).length;
  return (
    <Collapsible className="border-border rounded-md border">
      <CollapsibleTrigger className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm">
        {target.ready ? (
          <CheckCircle2Icon className="text-primary size-4 shrink-0" />
        ) : (
          <CircleAlertIcon className="text-muted-foreground size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{target.name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {target.ready ? "Ready" : `${passed}/${required.length}`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-1.5 px-3 pt-1 pb-3">
          {target.items.map((i) => (
            <li key={i.id} className="flex items-start gap-2 text-xs">
              {i.pass ? (
                <CheckCircle2Icon className="text-primary mt-px size-3.5 shrink-0" />
              ) : (
                <CircleIcon className={cn("mt-px size-3.5 shrink-0", i.level === "required" ? "text-destructive" : "text-muted-foreground")} />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn(!i.pass && i.level === "required" && "font-medium")}>{i.label}</span>
                {i.level === "recommended" && <span className="text-muted-foreground"> (recommended)</span>}
                <span className="text-muted-foreground block truncate">{i.detail}</span>
              </span>
            </li>
          ))}
          {target.source_url && (
            <li className="pt-1 text-xs">
              <a href={target.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground underline underline-offset-2">
                Requirements source
              </a>
            </li>
          )}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ResultNote({ result }: { result: PublishResult }) {
  return (
    <div className="bg-muted/50 space-y-1 rounded-md p-2.5 text-xs">
      <p className="font-medium">
        {result.kind === "webplayer" ? "Web player" : "Podcast feed"}: {result.chapters} chapters, {result.files.length} files
      </p>
      <p className="text-muted-foreground break-all">{result.zip_path ?? result.dir}</p>
      {result.warnings.map((w) => (
        <p key={w} className="text-muted-foreground">
          {w}
        </p>
      ))}
      {result.download_url && (
        <a href={result.download_url} className="text-foreground inline-flex items-center gap-1 underline underline-offset-2">
          <DownloadIcon className="size-3" /> Download zip
        </a>
      )}
    </div>
  );
}

export function PublishPanel({ bookId }: { bookId: string }) {
  const checklist = useChecklist(bookId);
  const web = usePublishWebPlayer(bookId);
  const rss = usePublishRss(bookId);
  const [rssOpen, setRssOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);

  const done = (r: PublishResult) => {
    setResult(r);
    toast.success(r.kind === "webplayer" ? "Web player exported" : "Podcast feed exported", { description: r.zip_path ?? r.dir });
  };

  let validUrl = false;
  try {
    const u = new URL(baseUrl);
    validUrl = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    validUrl = false;
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-semibold">Publish and share</h2>
        <p className="text-muted-foreground text-xs">
          What each route asks for, checked against this book. Exports are written to your data folder.
        </p>
      </div>
      <div className="space-y-1.5">
        {checklist.data?.map((t) => <TargetRow key={t.id} target={t} />)}
        {checklist.isError && <p className="text-muted-foreground text-xs">{checklist.error.message}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={web.isPending} onClick={() => web.mutate({}, { onSuccess: done })}>
          <GlobeIcon />
          {web.isPending ? "Exporting…" : "Web player"}
        </Button>
        <Button size="sm" variant="outline" disabled={rss.isPending} onClick={() => setRssOpen(true)}>
          <RssIcon />
          Podcast feed
        </Button>
      </div>
      {result && <ResultNote result={result} />}

      <Dialog open={rssOpen} onOpenChange={setRssOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export a podcast feed</DialogTitle>
            <DialogDescription>
              One episode per chapter, in order. Upload the folder to any static host; feed and audio links point at the
              address below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rss-base">Where the folder will be hosted</Label>
            <Input
              id="rss-base"
              placeholder="https://example.com/my-book/"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRssOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!validUrl || rss.isPending}
              onClick={() =>
                rss.mutate(
                  { base_url: baseUrl },
                  {
                    onSuccess: (r) => {
                      setRssOpen(false);
                      done(r);
                    },
                  },
                )
              }
            >
              {rss.isPending ? "Exporting…" : "Export feed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
