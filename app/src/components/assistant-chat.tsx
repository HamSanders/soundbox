/**
 * The studio assistant — a conversation that ends in a prompt.
 *
 * The Generate thread is a record of renders: you ask, audio comes back. This
 * is the other kind of thread, the one *before* a render: which model, why,
 * what the licence allows, what a prompt for that model should actually say.
 * It asks what it needs, explains what it knows, and when it has enough it
 * writes the request out as a card.
 *
 * It is a panel of both builders (see `routes/studio`) rather than a page of
 * its own, which is what makes it useful: the thread sits beside the timeline
 * it is talking about. What it proposes lands where the work is — the Prompt
 * panel one column over, already filled in — so the next thing you do is
 * "Generate & insert" rather than a copy and paste.
 *
 * Inside a studio (see `lib/studio-bridge.ts`) the same box also takes
 * instructions *about* that timeline — "name all the tracks",
 * "mute 1 and 3", "put a reverb on the vocal". Those go through the studio's
 * own planner (`/api/studio/command`, the vocabulary the command bar uses)
 * and its own apply handler, so an edit asked for in the chat is the same
 * edit as one asked for under the timeline: optimistic, and one Ctrl+Z away.
 * A turn the planner calls a description rather than an edit falls through
 * to the assistant, which is how one box serves both.
 *
 * Nothing is run from here without a person behind it: plain edits apply
 * as the command bar's Apply would, because undo covers them; anything that
 * deletes waits for a click.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  Loader2Icon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { KonchiMark } from "@/components/konchi-mark";
import { LoadingVerb } from "@/components/loading-verb";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, type AssistantLink, type AssistantOpener } from "@/lib/api";
import type { StudioAction, StudioContext } from "@/lib/studio-command";
import {
  DEFAULT_THREAD,
  threadForServer,
  threadMessages,
  useAssistantStore,
  useThread,
  type AssistantMessage,
} from "@/lib/assistant-store";
import { useAssistantChat, useAssistantEnabled, useAssistantOpeners } from "@/lib/queries";
import { useStudioBridge } from "@/lib/studio-bridge";
import {
  describeAction,
  isDestructive,
  needsConfirmation,
  panelForAction,
  runStudioCommand,
} from "@/lib/studio-command";
import { cn } from "@/lib/utils";

/**
 * Openers, shown on an empty thread.
 *
 * Each one is a *conversation* to start rather than a prompt to paste: the
 * assistant's value is the questions it asks back, and these are written to
 * make it ask them.
 */
const OPENERS: AssistantOpener[] = [
  { label: "Which model?", text: "Which of my models should I use, and which can I ship commercially?" },
  { label: "Horror door", text: "I need a door slam for a horror game" },
  { label: "Lo-fi loop", text: "Write me a 20 second lo-fi beat to loop under a menu" },
  { label: "Theme song", text: "Help me make a short theme song with vocals for an indie game about a lighthouse keeper" },
];

const OPENER_SKELETONS = ["w-24", "w-28", "w-20", "w-32"] as const;

function OpenerChips({ onPick }: { onPick: (text: string) => void }) {
  const bridge = useStudioBridge((s) => s.bridge);
  const studio = bridge?.context() ?? null;
  const { data, isPending, isError } = useAssistantOpeners(studio);
  const chips =
    !isError && data?.openers.length ? data.openers : OPENERS;

  return (
    <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Openers">
      {isPending
        ? OPENER_SKELETONS.map((w, i) => (
            <Skeleton key={i} className={cn("h-8 rounded-full", w)} />
          ))
        : chips.map((o, i) => (
            <Button
              key={`${o.label}-${i}`}
              type="button"
              variant="outline"
              size="sm"
              className="animate-in fade-in-0 slide-in-from-bottom-1 rounded-full duration-300 fill-mode-both"
              style={{ animationDelay: `${i * 70}ms` }}
              title={o.text}
              onClick={() => onPick(o.text)}
            >
              {o.label}
            </Button>
          ))}
    </div>
  );
}

export function AssistantChat({
  className,
  /**
   * Which conversation this is. A studio passes its story's key, so the
   * thread beside a timeline is the one about that timeline; the Chat page
   * takes the default. See `lib/assistant-store`.
   */
  threadKey = DEFAULT_THREAD,
  /**
   * Already inside a framed panel, so bring no frame of your own.
   *
   * The chat is dropped into two very different holes. On the Chat page and
   * as a studio's `soloChat` it sits on the bare page, and its composer is a
   * rounded card because nothing else there says "this is the thing you type
   * in". In the studio's left column it is now a tab inside a bordered,
   * `bg-card` panel — and a card inside a card is two borders and two
   * backgrounds a few pixels apart, which reads as a rendering fault rather
   * than a hierarchy. The pinned composer made it worse: it is opaque on
   * purpose, so the thread scrolls behind it rather than through it, and
   * `bg-background` against the panel's `bg-card` drew a visible block.
   *
   * So inset mode: the panel is the frame, the composer is a rule above the
   * input, and the fill matches what it is sitting on.
   */
  inset = false,
}: {
  className?: string;
  threadKey?: string;
  inset?: boolean;
}) {
  const thread = useThread(threadKey);
  const messages = thread.messages;
  const pending = thread.pending;
  const append = useAssistantStore((s) => s.append);
  const settle = useAssistantStore((s) => s.settle);
  const setPending = useAssistantStore((s) => s.setPending);
  const dropFrom = useAssistantStore((s) => s.dropFrom);
  const reset = useAssistantStore((s) => s.reset);
  const markEdits = useAssistantStore((s) => s.markEdits);
  const bridge = useStudioBridge((s) => s.bridge);

  const chat = useAssistantChat();
  /** With the prompt assistant off there is no answer to be had — see
   *  `AssistantOff` at the foot of this file. */
  const enabled = useAssistantEnabled();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // A half-typed message belongs to the conversation it was being typed into.
  // Switching studios without this carries it across, into a thread it was
  // very likely not about.
  useEffect(() => setText(""), [threadKey]);

  const lastKey = messages.length ? `${messages[messages.length - 1]!.id}:${pending}` : "";
  useEffect(() => {
    if (!lastKey) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastKey]);

  // Arriving at a thread with history should show its end, not its beginning —
  // and instantly, because a smooth scroll through a long conversation on
  // mount reads as the page being unfinished.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [threadKey]);

  /**
   * Send one turn. The assistant's message is appended empty first so the
   * thread shows where the answer will go; `settle` fills it in or marks it
   * failed. The whole thread goes with every request — the server keeps
   * nothing — plus the newest proposal as the draft, so "longer" has a thing
   * to be longer than.
   */
  const send = (content: string): void => {
    const trimmed = content.trim();
    if (!trimmed || pending) return;
    setText("");
    append(threadKey, { role: "user", content: trimmed });
    const id = append(threadKey, { role: "assistant", content: "" });
    setPending(threadKey, true);
    const finish = (): void => {
      setPending(threadKey, false);
      inputRef.current?.focus();
    };
    const askAssistant = (studio?: StudioContext): void => {
      const turns = threadForServer(threadMessages(threadKey));
      chat.mutate(
        { messages: turns, studio: studio ?? null },
        {
          onSuccess: (res) =>
            settle(threadKey, id, { content: res.reply, links: res.links, sources: res.sources }),
          onError: (err) => settle(threadKey, id, { error: errorMessage(err) }),
          onSettled: finish,
        },
      );
    };
    if (!bridge) {
      askAssistant();
      return;
    }
    // A studio is open: let its planner have first refusal. It answers with a
    // plan — an edit or a generation — or with nothing, and then this is a
    // conversation turn after all.
    const context = bridge.context();
    void runStudioCommand(trimmed, context)
      .then((plan) => {
        // Only an *empty* plan falls through. `intent === "generate"` used to
        // fall through too, which was the bug: a generation is work the studio
        // can do and the confirm card below is how it gets done, so handing it
        // to the guide instead produced a refusal — from the one component
        // whose entire identity is that it cannot make anything.
        if (plan.actions.length === 0) {
          // Not work after all — a question, or a description. The assistant
          // answers it *with the timeline in hand*, which is the difference
          // between "you have three tracks" and a paragraph about missing
          // context.
          askAssistant(context);
          return;
        }
        // Making and deleting wait for a person; moving and mixing do not.
        // See `needsConfirmation` — a script appearing unasked is startling
        // in a way that muting a track is not.
        const confirm = plan.actions.some(needsConfirmation);
        if (!confirm) bridge.apply(plan.actions, plan.summary);
        const destructive = plan.actions.some(isDestructive);
        settle(threadKey, id, {
          content:
            plan.summary ||
            (destructive
              ? "This would delete something — confirm below."
              : confirm
                ? "Ready when you are."
                : "Done."),
          edits: { actions: plan.actions, context, applied: !confirm },
          thinking: {
            classified: plan.classified,
            actions: plan.actions.length,
            dropped: plan.dropped,
          },
        });
        finish();
      })
      .catch(() => {
        // The planner failing (off, unreachable, mock) is not the end of the
        // turn — the assistant can still answer in words.
        askAssistant(context);
      });
  };

  /** Send the user turn before a failed reply again, without duplicating it
   *  in the thread: the failed pair is dropped and re-asked. */
  const retry = (failed: AssistantMessage): void => {
    const all = threadMessages(threadKey);
    const at = all.findIndex((m) => m.id === failed.id);
    const question = all[at - 1];
    if (!question || question.role !== "user") return;
    dropFrom(threadKey, question.id);
    send(question.content);
  };

  const empty = messages.length === 0;

  if (!enabled) return <AssistantOff className={className} />;

  return (
    /* Never taller than the window, whatever it is dropped into: the thread
       scrolls inside this box and the composer sits under it, rather than the
       page growing until the box you type in is somewhere below the fold.
       `100svh` is the honest version of 100vh on a phone, where the browser
       chrome is part of the viewport height right up until it isn't. */
    <div
      className={cn(
        "flex max-h-[100svh] min-h-0 flex-1 flex-col",
        // The panel's border is the box now, so the contents need the gutter
        // the composer's card used to provide.
        inset && "px-3",
        className,
      )}
    >
      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto py-10 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-2xl">
            <KonchiMark variant="icon" className="text-shell h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Talk it through first
            </h1>
            <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
              The assistant knows which models you have, what each is for, what
              its licence allows and how it likes to be prompted. Say what you
              need; it asks what it has to, writes the prompt, and hands it to
              the composer or straight onto a timeline.
            </p>
          </div>
          <OpenerChips onPick={send} />
        </div>
      ) : (
        <section
          aria-label="Assistant conversation"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto pt-2 pr-1 pb-6"
        >
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ) : (
              <AssistantBubble
                key={m.id}
                message={m}
                thinking={pending && m === messages[messages.length - 1] && !m.content && !m.error}
                onRetry={() => retry(m)}
                onApplyEdits={
                  bridge
                    ? (actions, summary) => {
                        bridge.apply(actions, summary);
                        markEdits(threadKey, m.id, true);
                      }
                    : null
                }
                onDiscardEdits={() => markEdits(threadKey, m.id, null)}
                onOpenArtifact={bridge ? (panel) => bridge.showPanel(panel) : null}
              />
            ),
          )}
          <div ref={endRef} />
        </section>
      )}

      {/* The composer, pinned: it is the bottom of the box rather than the
          bottom of the thread, so it stays put while the conversation scrolls
          behind it. */}
      <div
        className={cn(
          "z-20 shrink-0",
          inset
            ? // Full-bleed rule: the negative margin puts the line on the
              // panel's edges rather than inside its gutter, so it reads as
              // the seam between thread and composer.
              "bg-card border-border/60 -mx-3 border-t px-3 py-2"
            : "bg-background pt-4 pb-3",
        )}
      >
        <div
          className={cn(
            "flex items-end gap-2",
            !inset && "border-border bg-card rounded-2xl border p-2 shadow-sm",
          )}
        >
          <Textarea
            ref={inputRef}
            value={text}
            disabled={pending}
            placeholder={
              bridge
                ? "Say what to change — name the tracks, mute 1 and 3, add reverb to the vocal…"
                : empty
                  ? "What do you need? A sound, a track, or a question about your models."
                  : "Reply, or say what to change…"
            }
            aria-label="Message the studio assistant"
            className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent py-2 shadow-none focus-visible:ring-0 dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          {!empty && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Start a new conversation"
                  disabled={pending}
                  onClick={() => reset(threadKey)}
                >
                  <Trash2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            size="icon-sm"
            aria-label="Send"
            disabled={pending || !text.trim()}
            onClick={() => send(text)}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
          </Button>
        </div>
        {/* Dropped in a panel: at a fifth of the window this wraps to two
            centred lines under the box, which is a lot of column spent on a
            convention the page-width chat has already taught. */}
        <p
          className={cn(
            "text-muted-foreground mt-2 text-center text-xs",
            inset && "hidden",
          )}
        >
          <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to
          send · <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">Shift</kbd>{" "}
          + <kbd className="bg-muted rounded border px-1 py-0.5 font-mono text-[10px]">Enter</kbd>{" "}
          for a new line
        </p>
      </div>
    </div>
  );
}

/**
 * The assistant, switched off.
 *
 * Every turn — a reply, a plan for the timeline, a rewritten prompt — needs
 * the local model, and with the mode off the server refuses before it reads
 * the question. An input box that can only produce the same error four times
 * is not a degraded feature, it is a trap, so the box goes and the switch
 * takes its place.
 *
 * Shown rather than hidden *here* because this page is where you would come
 * looking for the assistant: something has to say what it is and where the
 * switch lives. Inside a studio the panel is dropped from the stack instead
 * (see `routes/studio`) — a working surface is not the place to advertise a
 * feature you have not turned on.
 */
function AssistantOff({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-5 py-10 text-center",
        className,
      )}
    >
      <div className="bg-muted flex size-12 items-center justify-center rounded-2xl">
        <KonchiMark variant="icon" className="text-shell h-6" />
      </div>
      <div className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          The assistant is off
        </h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
          It runs on a small language model, on your machine, and the prompt
          assistant is switched off — so there is nothing here to answer you.
          Turn it on and it can pick a model for your sound, write the prompt
          for it, and take instructions about a timeline you have open.
        </p>
      </div>
      <Button asChild>
        <Link to="/settings">
          Turn on the prompt assistant
          <ArrowRightIcon />
        </Link>
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- bubble */

function AssistantBubble({
  message,
  thinking,
  onRetry,
  onApplyEdits,
  onDiscardEdits,
  onOpenArtifact,
}: {
  message: AssistantMessage;
  thinking: boolean;
  onRetry: () => void;
  onOpenArtifact: ((panel: string) => void) | null;
  /** Null when no studio is open any more — a waiting plan then has nothing
   *  to apply to, and says so. */
  onApplyEdits: ((actions: StudioAction[], summary: string) => void) | null;
  onDiscardEdits: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
        <KonchiMark variant="icon" className="text-shell h-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {thinking ? (
          <p className="text-muted-foreground flex items-center gap-2 py-1.5 text-sm">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            <LoadingVerb />
          </p>
        ) : message.error ? (
          <div className="border-destructive/40 bg-destructive/5 rounded-xl border px-3 py-2 text-sm">
            <p className="text-destructive flex items-center gap-1.5">
              <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {message.error}
            </p>
            <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={onRetry}>
              <RotateCcwIcon /> Try again
            </Button>
          </div>
        ) : (
          <Reply text={message.content} />
        )}
        {message.thinking && !thinking && <ThinkingNote note={message.thinking} />}
        {!!message.links?.length && !thinking && <LinkRow links={message.links} />}
        {message.edits && !thinking && (
          <EditsCard
            edits={message.edits}
            summary={message.content}
            onApply={onApplyEdits}
            onDiscard={onDiscardEdits}
            onOpenArtifact={onOpenArtifact}
          />
        )}
        {!!message.sources?.length && !thinking && <SourceNote sources={message.sources} />}
      </div>
    </div>
  );
}

/** Paragraphs and simple `- ` lists, with `**bold**` — the whole of the
 *  formatting a reply is allowed, and all a small local model reliably
 *  produces. A markdown renderer would be a dependency for three rules. */
function Reply({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

/**
 * What the assistant worked out, folded away under the reply.
 *
 * Closed by default because it is an explanation, not an answer — but it is
 * the first thing worth opening when a request lands somewhere odd, since
 * the routing decision is usually the surprise. "Read as: compose" against a
 * request to mute a track says more than an empty plan ever could.
 */
const ROUTED: Record<string, string> = {
  edit: "an edit to the timeline",
  script: "words to be spoken",
  generate_clip: "a new sound to make",
  compose: "a whole piece to compose",
  panel: "a change to the interface",
};

function ThinkingNote({
  note,
}: {
  note: NonNullable<AssistantMessage["thinking"]>;
}) {
  const [open, setOpen] = useState(false);
  const routed = note.classified ? (ROUTED[note.classified] ?? note.classified) : null;
  return (
    <div className="text-muted-foreground text-xs">
      <button
        type="button"
        className="hover:text-foreground inline-flex items-center gap-1"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRightIcon
          className={cn("size-3 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        Thinking
      </button>
      {open && (
        <ul className="border-border/60 mt-1 ml-1.5 space-y-0.5 border-l pl-3">
          {routed && <li>Read it as {routed}.</li>}
          {note.actions !== undefined && (
            <li>
              Planned {note.actions} {note.actions === 1 ? "change" : "changes"}.
            </li>
          )}
          {note.dropped ? (
            <li>
              Dropped {note.dropped} that named something not on this timeline.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- edits */

/**
 * What a turn did to the studio, one line per edit in the user's own terms —
 * the same `describeAction` the command bar previews with. Applied edits are
 * a receipt (undo is in the studio); a destructive plan is a question, with
 * the deleting lines in red and the Apply button waiting.
 */
function EditsCard({
  edits,
  summary,
  onApply,
  onDiscard,
  onOpenArtifact,
}: {
  edits: NonNullable<AssistantMessage["edits"]>;
  summary: string;
  onApply: ((actions: StudioAction[], summary: string) => void) | null;
  onDiscard: () => void;
  /** Show the panel these edits landed in. Null when no studio is open — the
   *  card is then a record of something that happened elsewhere. */
  onOpenArtifact: ((panel: string) => void) | null;
}) {
  // Where this turn's work lives, so the card can take you back to it.
  const panel = edits.actions.map(panelForAction).find((p): p is string => p !== null) ?? null;
  const openable = panel !== null && onOpenArtifact !== null && edits.applied;
  return (
    <div
      className={cn(
        "border-border bg-card rounded-xl border p-3 shadow-sm",
        openable && "hover:border-foreground/25 cursor-pointer transition-colors",
      )}
      {...(openable
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `Open the ${panel} panel`,
            onClick: () => onOpenArtifact(panel),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenArtifact(panel);
              }
            },
          }
        : {})}
    >
      <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        {edits.applied ? (
          <>
            <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
            Applied to the studio — Ctrl+Z there undoes it
          </>
        ) : (
          <>
            <TriangleAlertIcon className="text-destructive size-3.5" aria-hidden="true" />
            Waiting for you — this deletes something
          </>
        )}
      </p>
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        {edits.actions.map((action, i) => (
          <li key={i} className={cn("font-mono", isDestructive(action) && "text-destructive")}>
            {describeAction(action, edits.context)}
          </li>
        ))}
      </ul>
      {openable && (
        <p className="text-muted-foreground mt-2 text-[11px]">Click to open the {panel}.</p>
      )}
      {!edits.applied && (
        <div className="mt-2 flex gap-2">
          {onApply ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onApply(edits.actions, summary);
              }}
            >
              Apply {edits.actions.length} {edits.actions.length === 1 ? "edit" : "edits"}
            </Button>
          ) : (
            <p className="text-muted-foreground text-xs">The studio is closed; open it again to apply.</p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
          >
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- links */

/**
 * Where the answer points.
 *
 * The guide does no work, so a turn ends in directions rather than a request
 * to run. Buttons rather than prose, because "that is on the Models page" is
 * only half an answer when the other half is a click. Every `to` was checked
 * against the real route table server-side, so an invented path is dropped
 * there rather than rendered as a dead button here.
 */
function LinkRow({ links }: { links: AssistantLink[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Button key={link.to} asChild size="sm" variant="outline">
          <Link to={link.to}>
            {link.label}
            <ArrowRightIcon />
          </Link>
        </Button>
      ))}
    </div>
  );
}

/** Which documentation the answer came out of. Small, and last: it is there
 *  to be checked, not read. */
function SourceNote({ sources }: { sources: string[] }) {
  return <p className="text-muted-foreground text-xs">From {sources.join(" · ")}</p>;
}
