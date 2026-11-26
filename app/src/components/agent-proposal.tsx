/**
 * An agent turn's tool calls, as a `ProposalCard`.
 *
 * The calls are MCP tool calls (see `server/src/llm/agent.ts`). Reading
 * ones run as soon as the card appears, since they change nothing. The rest
 * wait: Accept runs them in order through `POST /api/agent/run`, one at a
 * time, and stops at the first that fails, because a later step usually
 * builds on an earlier one. Undo runs each step's inverse, newest first, for
 * the steps that have one; the card names the ones that don't.
 */

import { useEffect, useRef } from "react";

import { ProposalCard, type ProposalItem, type ProposalRisk, type ProposalStatus } from "@/components/proposal-card";
import { api, errorMessage, type AgentCall } from "@/lib/api";
import { useAgentScope } from "@/lib/agent-scope";
import { useAssistantStore, type AgentProposal, type AgentStepStatus } from "@/lib/assistant-store";

/** What a tool does, in the words of someone using the app. */
const TOOL_WORDS: Record<string, string> = {
  "soundbox.set_character_voice": "Set a character's voice",
  "soundbox.add_pronunciation": "Add a pronunciation",
  "soundbox.render_audiobook": "Voice the text",
  "soundbox.master_and_export_audiobook": "Master and export the book",
  "soundbox.add_bed": "Add a bed",
  "soundbox.edit_paragraph": "Change a paragraph",
  "soundbox.cast_paragraphs": "Change who reads paragraphs",
  "soundbox.lock_paragraphs": "Lock paragraphs",
  "soundbox.split_paragraph": "Split a paragraph",
  "soundbox.merge_paragraphs": "Merge two paragraphs",
  "soundbox.find_replace": "Find and replace",
  "soundbox.add_chapter": "Add a chapter",
  "soundbox.edit_chapter": "Change a chapter",
  "soundbox.move_chapter": "Move a chapter",
  "soundbox.delete_chapter": "Delete a chapter",
  "soundbox.update_line": "Change a line",
  "soundbox.delete_line": "Delete a paragraph",
  "soundbox.split_line": "Split a paragraph",
  "soundbox.add_lines": "Add lines",
  "soundbox.mix_track": "Change a lane's mix",
  "soundbox.remove_track": "Remove a lane",
  "soundbox.add_device": "Add an effect",
  "soundbox.set_device": "Change an effect",
  "soundbox.remove_device": "Remove an effect",
  "soundbox.generate": "Make a sound",
  "soundbox.speak": "Speak lines",
  "soundbox.speak_story": "Voice a story",
  "soundbox.create_audiobook": "Create an audiobook",
  "soundbox.import_manuscript": "Import a manuscript",
  "soundbox.get_audiobook": "Read the book",
  "soundbox.list_voices": "List your voices",
  "soundbox.list_audiobooks": "List your audiobooks",
  "soundbox.delete_sound": "Delete a sound",
};

const RISK_BADGE: Record<string, string | undefined> = {
  costly: "makes audio",
  destructive: "deletes",
};

/** Arguments that are the open book or its chapter's story: saying them
 *  again on every row is noise. */
const CONTEXT_ARGS = new Set(["book_id", "story_id"]);

function humanize(tool: string): string {
  const words = tool.replace(/^soundbox\./, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function short(value: unknown, nameOf: (id: string) => string | undefined): string {
  if (typeof value === "string") {
    const named = nameOf(value);
    if (named) return named;
    return value.length > 80 ? `“${value.slice(0, 79)}…”` : value.includes(" ") ? `“${value}”` : value;
  }
  if (Array.isArray(value)) {
    const parts = value.slice(0, 3).map((v) => short(v, nameOf));
    return value.length > 3 ? `${parts.join(", ")} and ${value.length - 3} more` : parts.join(", ");
  }
  if (value === null) return "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function describeCall(call: AgentCall, nameOf: (id: string) => string | undefined = () => undefined) {
  const label = TOOL_WORDS[call.tool] ?? humanize(call.tool);
  const detail = Object.entries(call.arguments)
    .filter(([key]) => !CONTEXT_ARGS.has(key))
    .map(([key, value]) => `${key.replace(/_id(s?)$/, "$1").replace(/_/g, " ")}: ${short(value, nameOf)}`)
    .join(" · ");
  return { label, detail };
}

/** A line on what a run returned, when it says something worth seeing. */
function noteFor(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.note === "string") return r.note;
  if (typeof r.message === "string") return r.message;
  return null;
}

function overall(steps: AgentProposal["steps"]): ProposalStatus {
  const live = steps.filter((s) => s.risk !== "read");
  const all = live.length ? live : steps;
  if (all.some((s) => s.status === "applying")) return "applying";
  if (all.some((s) => s.status === "proposed")) return "proposed";
  if (all.some((s) => s.status === "failed")) return "failed";
  if (all.every((s) => s.status === "rejected")) return "rejected";
  if (all.every((s) => s.status === "undone" || s.status === "rejected")) return "undone";
  return "applied";
}

export function AgentProposalCard({
  threadKey,
  messageId,
  proposal,
  onTweak,
}: {
  threadKey: string;
  messageId: string;
  proposal: AgentProposal;
  /** Put the instruction back in the composer. */
  onTweak: (instruction: string) => void;
}) {
  const update = useAssistantStore((s) => s.updateProposal);
  const scope = useAgentScope((s) => s.scope);
  const nameOf = scope?.nameOf ?? (() => undefined);
  const busy = useRef(false);

  const setStep = (id: string, patch: Partial<AgentProposal["steps"][number]>) =>
    update(threadKey, messageId, (p) => ({
      ...p,
      steps: p.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  /** Run these steps in order; stop at the first failure. */
  const run = async (ids: string[]) => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const id of ids) {
        const step = useAssistantStore
          .getState()
          .threads[threadKey]?.messages.find((m) => m.id === messageId)
          ?.proposal?.steps.find((s) => s.id === id);
        if (!step || step.status !== "proposed") continue;
        setStep(id, { status: "applying" });
        try {
          const res = await api.agentRun(step.call);
          setStep(id, { status: "applied", undo: res.undo, note: noteFor(res.result) });
        } catch (err) {
          setStep(id, { status: "failed", note: errorMessage(err) });
          break;
        }
      }
    } finally {
      busy.current = false;
      useAgentScope.getState().scope?.changed();
    }
  };

  /** Undo the applied steps that can be, newest first. */
  const undo = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const done = [...proposal.steps].reverse().filter((s) => s.status === "applied" && s.undo?.length);
      for (const step of done) {
        try {
          for (const call of step.undo!) await api.agentRun(call);
          setStep(step.id, { status: "undone", note: null });
        } catch (err) {
          setStep(step.id, { note: `Couldn't undo: ${errorMessage(err)}` });
          break;
        }
      }
    } finally {
      busy.current = false;
      useAgentScope.getState().scope?.changed();
    }
  };

  // Reading changes nothing, so it doesn't wait for a click.
  const reads = proposal.steps.filter((s) => s.risk === "read" && s.status === "proposed").map((s) => s.id);
  const readKey = reads.join(",");
  useEffect(() => {
    if (readKey) void run(readKey.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per new set of reads
  }, [readKey]);

  const status = overall(proposal.steps);
  const pending = proposal.steps.filter((s) => s.status === "proposed" && s.risk !== "read");
  const risk: ProposalRisk = pending.some((s) => s.risk === "destructive")
    ? "destructive"
    : pending.some((s) => s.risk === "costly")
      ? "costly"
      : "safe";
  const undoable = proposal.steps.filter((s) => s.status === "applied" && s.undo?.length);
  const stuck = proposal.steps.filter((s) => s.status === "applied" && !s.undo?.length && s.risk !== "read");

  const items: ProposalItem[] = proposal.steps.map((s) => {
    const { label, detail } = describeCall(s.call, nameOf);
    return {
      id: s.id,
      label,
      detail: s.note ? (detail ? `${detail} · ${s.note}` : s.note) : detail,
      status: s.status as ProposalStatus,
      tone: s.risk === "destructive" ? "destructive" : s.risk === "read" ? "muted" : "default",
      badge: RISK_BADGE[s.risk],
    };
  });
  if (proposal.dropped.length) {
    items.push({
      id: "dropped",
      label: `Left out ${proposal.dropped.length} step${proposal.dropped.length === 1 ? "" : "s"} it couldn't check`,
      detail: proposal.dropped.map((d) => `${humanize(d.tool)}: ${d.reason}`).join(" · "),
      tone: "muted",
      status: "rejected" as AgentStepStatus,
    });
  }

  return (
    <ProposalCard
      status={status}
      risk={risk}
      items={items}
      receipt="Done. Your book is updated"
      acceptLabel={pending.length > 1 ? `Accept all ${pending.length}` : "Accept"}
      onAccept={scope ? () => void run(pending.map((s) => s.id)) : null}
      waitingNote="Open the book again to run these."
      onReject={() => pending.forEach((s) => setStep(s.id, { status: "rejected" }))}
      onTweak={() => onTweak(proposal.instruction)}
      onAcceptItem={(id) => void run([id])}
      onRejectItem={(id) => setStep(id, { status: "rejected" })}
      onUndo={undoable.length ? () => void undo() : null}
      undoNote={
        stuck.length
          ? `${stuck.map((s) => describeCall(s.call).label).join(", ")} can't be undone from here.`
          : undefined
      }
    />
  );
}
