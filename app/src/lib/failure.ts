/**
 * Helpers behind `FailureCard`, kept out of the component file so fast
 * refresh keeps working there.
 */

import type { Failure } from "@/lib/api";

/** The card's shape for an error that was only ever a string. */
export function failureFromError(error: string | null | undefined): Failure {
  const text = (error ?? "").trim();
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return {
    topic: null,
    title: line.length > 160 ? `${line.slice(0, 157)}…` : line || "Something went wrong",
    hint: null,
    fixes: [],
    terminal: false,
    stage: null,
    detail: text,
  };
}

/** The block Copy diagnostic puts on the clipboard: enough for an issue,
 *  nothing personal beyond what the error text itself contains. */
export function diagnosticText(failure: Failure, context?: string | null): string {
  return [
    "Konchi failure",
    `topic: ${failure.topic ?? "unclassified"}`,
    `stage: ${failure.stage ?? "unknown"}`,
    context ? `context: ${context}` : null,
    `when: ${new Date().toISOString()}`,
    `app: ${location.origin}`,
    "---",
    failure.title,
    "",
    failure.detail,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

