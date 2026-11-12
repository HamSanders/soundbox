/**
 * Asking the studio for an edit, and watching it come back as a list of
 * operations you can read before any of them happen.
 *
 * This is the section that has to carry the least believable claim on the
 * page — "talk to it and it edits your arrangement" — which is exactly why it
 * shows the intermediate step rather than a before and after. The interesting
 * part is not that a sentence becomes a change; it is that the change arrives
 * as `Add reverb to track 3` on screen, in the same words `describeAction`
 * puts in the real preview, before anything is applied.
 *
 * The action strings, the intents and the device kinds are all real: see
 * `server/src/llm/studio.ts` for the `StudioAction` union and the
 * `edit | generate_clip | compose | script | panel` intent split, and
 * `app/src/lib/studio-command.ts` for the previews. Three properties of that
 * design are worth more than any adjective and are said plainly in the copy:
 * the model picks from ids it was handed rather than naming things, it returns
 * data rather than running anything, and the page applies each action through
 * the same hook a human's click goes through — so an agentic edit lands on the
 * undo stack exactly like a manual one.
 */

import {
  AudioLinesIcon,
  MicIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { cn } from "@/lib/utils";

/** One turn of the conversation: what was typed, how it was classified, and
 *  the operations that came back. */
interface Exchange extends StageStep {
  said: string;
  /** The real `StudioIntent` this routes to. */
  intent: "edit" | "generate_clip" | "compose" | "script" | "panel";
  icon: LucideIcon;
  /** Action previews, worded as `describeAction` words them. */
  actions: string[];
}

const EXCHANGES: Exchange[] = [
  {
    said: "put rain under the whole scene",
    intent: "generate_clip",
    icon: SparklesIcon,
    actions: ['Generate “rain on a tin roof” onto track 0 at 0.00s'],
    title: "Ask for a sound",
    detail:
      "A new sound, generated and placed in one go. The model picks the lane and the start time from the arrangement it was shown.",
  },
  {
    said: "this track needs reverb",
    intent: "edit",
    icon: SlidersHorizontalIcon,
    actions: ["Add reverb to track 3", "Set reverb on track 3: decay 2.4, mix 0.35"],
    title: "Ask for an effect",
    detail:
      "There are eight device kinds: compressor, eq, reverb, delay, distortion, gate, limiter and autotune. The model may only name one of those. Any other name is dropped, because the rack cannot build it.",
  },
  {
    said: "rename all tracks to what is on them",
    intent: "edit",
    icon: PencilIcon,
    actions: [
      "Rename track 0 to “Ambience”",
      "Rename track 1 to “Foley”",
      "Rename track 2 to “Impacts”",
      "Rename track 3 to “Design”",
    ],
    title: "Ask for four things at once",
    detail:
      "One sentence, four operations, each listed separately. They apply through the same hooks your clicks go through, so the whole batch is a single undo away.",
  },
  {
    said: "write a two-line exchange between the guard and the thief",
    intent: "script",
    icon: AudioLinesIcon,
    actions: ["Write 2 lines for Guard, Thief"],
    title: "Ask for words",
    detail:
      "Script is its own intent. The lines land in the Script panel as written-but-unspoken clips, holding their place on the timeline before any voice has read them.",
  },
  {
    said: "read them aloud",
    intent: "edit",
    icon: MicIcon,
    actions: ["Read 2 lines aloud"],
    title: "Then hear it",
    detail:
      "The written lines become audio on the lanes they already sit on. Writing, arranging and voicing all happen in the same view.",
  },
];

function IntentPill({ intent }: { intent: Exchange["intent"] }) {
  return (
    <span className="border-primary/50 bg-primary/10 text-foreground inline-block rounded-full border px-2 py-0.5 font-mono text-[10px]">
      intent: {intent}
    </span>
  );
}

export function RevealAgenticChat() {
  return (
    <ScrollStage
      id="chat"
      eyebrow="Chat, script and timeline"
      title="Say what you want changed, read it back, then apply it"
      intro="The assistant returns a list of operations and never runs them itself. It picks from the clip ids and lane numbers it was given, and anything it invents is thrown away before it reaches the API."
      steps={EXCHANGES}
      layout="text-left"
      lane={1}
    >
      {(_progress, step, select) => (
        <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
          <WindowChrome label="Chat: a studio panel, beside the timeline it edits" />

        {/* A column, not a stack of absolutely-positioned pieces: the thread
            and the suggestions each need their own space, and the four-operation
            answer is tall enough that overlaying them put chips straight through
            the middle of it. The thread area is the flexible part and the
            suggestions keep their intrinsic height at the bottom, so the panel
            is a fixed size whichever exchange is showing. */}
        <div className="flex flex-col p-4 sm:p-5">
          {/* Explicit height rather than `flex-1`: the exchanges are absolutely
              positioned so they can cross-fade, which means they contribute no
              height and a flexible parent collapses to whatever is left over —
              the four-operation answer then overflowed straight through the
              suggestions below it. Sized for that longest answer, so the panel
              is the same height on every step. */}
          <div className="relative h-[15.5rem]">
            {EXCHANGES.map((ex, i) => {
              const Icon = ex.icon;
              return (
                <div
                  key={ex.said}
                  className={cn(
                    "absolute inset-0",
                    "transition-[opacity,transform] duration-500 motion-reduce:transition-none",
                    i === step
                      ? "translate-y-0 opacity-100"
                      : "pointer-events-none translate-y-2 opacity-0",
                  )}
                  aria-hidden={i === step ? undefined : "true"}
                >
                  {/* What was typed. */}
                  <div className="flex justify-end">
                    <p className="bg-primary/15 ring-primary/25 max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm ring-1">
                      {ex.said}
                    </p>
                  </div>

                  {/* What came back: a classification, then operations. */}
                  <div className="mt-3 flex gap-2">
                    <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <IntentPill intent={ex.intent} />
                      <ul className="mt-2 space-y-1.5">
                        {ex.actions.map((action, a) => (
                          <li
                            key={action}
                            className={cn(
                              "border-border/60 bg-background/60 rounded-lg border px-2.5 py-1.5",
                              "font-mono text-[11px] leading-relaxed",
                              // Staggered so a four-operation answer reads as
                              // a list arriving rather than a block appearing.
                              "transition-[opacity,transform] duration-300 motion-reduce:transition-none",
                              i === step ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                            )}
                            style={{ transitionDelay: i === step ? `${120 + a * 90}ms` : "0ms" }}
                          >
                            {action}
                          </li>
                        ))}
                      </ul>
                      <p className="text-muted-foreground/70 mt-2.5 text-[11px]">
                        Review, then apply. Each one lands on the undo stack.
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Suggestions, along the bottom the way a chat box offers them.
              This is the section's step control, and it is the one place a row
              of chips is not a bolted-on stepper: asking is what this panel is
              *for*, so "here are other things you could ask" is the product's
              own affordance rather than page furniture. */}
          <div className="border-border/50 mt-3 shrink-0 border-t pt-3">
            <p className="label-caps text-muted-foreground/60 mb-1.5">
              Try asking
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {EXCHANGES.map((ex, i) => (
                <li key={ex.said}>
                  <button
                    type="button"
                    onClick={() => select(i)}
                    aria-current={i === step ? "step" : undefined}
                    className={cn(
                      "focus-visible:ring-ring/50 max-w-[13rem] cursor-pointer truncate rounded-full border px-2.5 py-1 text-left text-[11px] outline-none focus-visible:ring-2",
                      "transition-colors duration-300 motion-reduce:transition-none",
                      i === step
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border/50 text-muted-foreground/70 hover:border-border hover:text-foreground",
                    )}
                  >
                    {ex.said}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        </figure>
      )}
    </ScrollStage>
  );
}
