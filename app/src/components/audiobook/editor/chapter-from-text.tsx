/**
 * Paste text to make a chapter. The server splits it into paragraphs with
 * the importer's cleanup: blank lines separate paragraphs, wrapped lines
 * are joined, hyphens mended, Markdown stripped. A heading line becomes the
 * title, or a heading paragraph after the first.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useChapterFromText } from "@/lib/audiobook-queries";

export function ChapterFromTextDialog({
  bookId,
  open,
  onOpenChange,
  position,
  onCreated,
}: {
  bookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to insert; default the end. */
  position?: number | null;
  onCreated: (chapterId: string) => void;
}) {
  const create = useChapterFromText(bookId);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState(false);
  // A rough count for the button; the server's cleanup decides the rest.
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim()).length;

  const submit = () =>
    create.mutate(
      { text, title: title.trim() || null, markdown, position: position ?? null },
      {
        onSuccess: (chapter) => {
          setText("");
          setTitle("");
          onOpenChange(false);
          onCreated(chapter.id);
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chapter from text</DialogTitle>
          <DialogDescription>
            Paste a chapter. Blank lines separate paragraphs; wrapped lines are joined and broken
            words mended. A heading line at the top becomes the chapter title.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="from-text-title" className="text-xs">
              Title (optional)
            </Label>
            <Input
              id="from-text-title"
              value={title}
              placeholder="From the first heading line"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <Textarea
            value={text}
            rows={14}
            aria-label="Chapter text"
            placeholder="Paste the chapter here…"
            className="font-[inherit] text-sm"
            onChange={(e) => setText(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={markdown} onCheckedChange={setMarkdown} />
            The text is Markdown
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!text.trim() || create.isPending} onClick={submit}>
            Add chapter{blocks > 0 ? ` (about ${blocks} paragraph${blocks === 1 ? "" : "s"})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
