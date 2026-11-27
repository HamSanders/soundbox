/**
 * Edit a value where it's shown, instead of in a dialog with one field.
 *
 * Linear edits a property where it's displayed, on the card or the row
 * (https://linear.app/docs/assigning-issues), and Things opens a to-do in
 * place in the list (https://culturedcode.com/things/features/). This is
 * that, for names, titles and notes. See §4.3 and §6.2 of
 * docs/redesign-2026-11/dialogs-and-forms-audit.md.
 *
 * - Click, Enter or F2 on the text starts editing. The text becomes a field
 *   in the same font and place.
 * - Enter or clicking away saves; Escape puts it back. Multi-line fields save
 *   on Ctrl+Enter (Cmd+Enter), and Enter is a new line.
 * - An empty value puts it back, unless `allowEmpty` (notes, an author).
 * - The new value shows at once. If `onCommit` rejects, the old one returns;
 *   the mutation's own error toast says why.
 *
 * When a click on the text already means something else (play the sound,
 * open its details), pass `activate="manual"` with the usual element as
 * `children`, and start editing through `editing` / `onEditingChange` (a
 * Rename menu item, F2).
 */

import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface InlineEditProps {
  value: string;
  /** Called only with a changed value; empty only when `allowEmpty`. */
  onCommit: (next: string) => unknown;
  /** What the value is, for screen readers: "Sound name". */
  label: string;
  /** The element around the text, e.g. "h1". Its classes style both states. */
  as?: ElementType;
  className?: string;
  /** Shown, muted, when the value is empty: "Add notes". */
  placeholder?: string;
  multiline?: boolean;
  allowEmpty?: boolean;
  /** Controlled editing, for a Rename menu item or a parent's F2. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** "click" (the default): the text itself starts editing. "manual": only
   *  `editing` does, and `children` is shown otherwise. As a function it
   *  gets the value to show, which is the new one while it saves. */
  activate?: "click" | "manual";
  children?: ReactNode | ((shown: string) => ReactNode);
}

/** Start editing on F2, the rename key in Windows Explorer and most file lists. */
export const isRenameKey = (e: KeyboardEvent) => e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey;

export function InlineEdit({
  value,
  onCommit,
  label,
  as: As = "span",
  className,
  placeholder,
  multiline = false,
  allowEmpty = false,
  editing: editingProp,
  onEditingChange,
  activate = "click",
  children,
}: InlineEditProps) {
  const [ownEditing, setOwnEditing] = useState(false);
  const editing = editingProp ?? ownEditing;
  const setEditing = (next: boolean) => {
    setOwnEditing(next);
    onEditingChange?.(next);
  };

  const [draft, setDraft] = useState(value);
  /** The value just saved, shown until the new one comes back from the server. */
  const [pending, setPending] = useState<string | null>(null);
  const shown = pending ?? value;
  useEffect(() => setPending(null), [value]);

  /** Escape and the commit itself both end the edit; the blur that follows
   *  must not save a second time. */
  const ended = useRef(false);
  /** Hand focus back to the text after a keyboard finish, so Tab continues
   *  from where you were. */
  const refocus = useRef(false);
  const display = useRef<HTMLButtonElement>(null);
  /** Around `children` in manual mode, to find their button to refocus. */
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (editing) {
      ended.current = false;
      setDraft(shown);
    } else if (refocus.current) {
      refocus.current = false;
      const target = display.current ?? wrap.current?.querySelector<HTMLElement>("button, a, [tabindex]");
      target?.focus();
    }
    // Only on entering or leaving edit mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = (save: boolean, viaKey: boolean) => {
    if (ended.current) return;
    ended.current = true;
    refocus.current = viaKey;
    setEditing(false);
    if (!save) return;
    const next = draft.trim();
    if (next === shown.trim() || (!next && !allowEmpty)) return;
    setPending(next);
    Promise.resolve()
      .then(() => onCommit(next))
      .catch(() => setPending(null));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // The panels close on Escape and the page has its own Ctrl+Z; neither
    // should see keys meant for this field.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false, true);
    } else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish(true, true);
    }
  };

  if (editing) {
    const field = {
      autoFocus: true,
      value: draft,
      "aria-label": label,
      placeholder,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onKeyDown,
      onBlur: () => finish(true, false),
      onFocus: (e: { target: HTMLInputElement | HTMLTextAreaElement }) => e.target.select(),
      // Same font, size and case as the text it replaces; the field's own
      // border and padding sit just outside it so nothing shifts.
      className: cn(
        "-mx-1.5 w-[calc(100%+0.75rem)] px-1.5 [font:inherit] [letter-spacing:inherit] [text-transform:inherit]",
        // The field's own size classes would otherwise beat `font: inherit`.
        "text-[length:inherit] leading-[inherit] md:text-[length:inherit]",
        // One line tall plus the border, which the negative margin hides.
        multiline ? "min-h-0 py-1" : "-my-px h-[calc(1lh+2px)] py-0",
      ),
    };
    return (
      // The field's border sits just outside the text, so a truncating
      // heading mustn't clip it.
      <As className={cn(className, "overflow-visible!")}>
        {multiline ? <Textarea {...field} rows={2} /> : <Input {...field} />}
      </As>
    );
  }

  if (activate === "manual")
    return (
      <span ref={wrap} className="contents">
        {typeof children === "function" ? children(shown) : children}
      </span>
    );

  return (
    <As className={className}>
      <button
        ref={display}
        type="button"
        aria-label={`${label}: ${shown || "empty"}`}
        title="Click to edit"
        aria-keyshortcuts="F2"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (isRenameKey(e)) {
            e.preventDefault();
            setEditing(true);
          }
        }}
        // Hover and focus fill the text's own box rather than drawing a ring
        // outside it, which a truncating heading would clip.
        className={cn(
          "hover:bg-muted/70 focus-visible:bg-muted focus-visible:decoration-ring max-w-full cursor-text rounded-sm text-left underline-offset-4 outline-none focus-visible:underline focus-visible:decoration-2",
          multiline ? "whitespace-pre-wrap" : "truncate",
          !shown && "text-muted-foreground",
        )}
      >
        {shown || placeholder}
      </button>
    </As>
  );
}
