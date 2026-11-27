/**
 * Undo instead of "Are you sure?" (app/src/lib/undo.ts): a delete is held
 * until its toast closes and sent exactly once, Undo means it never happens,
 * a failed request puts the item back, and a create's Undo runs its inverse.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Opts = {
  action?: { onClick: () => void };
  cancel?: { onClick: () => void };
  onAutoClose?: () => void;
  onDismiss?: () => void;
};
const shown: Opts[] = [];
vi.mock("sonner", () => {
  const toast = Object.assign(
    (_m: string, o: Opts) => {
      shown.push(o);
      return shown.length;
    },
    {
      success: (_m: string, o: Opts) => {
        shown.push(o);
        return shown.length;
      },
      error: vi.fn(),
      dismiss: vi.fn((id: number) => shown[id - 1]?.onDismiss?.()),
    },
  );
  return { toast };
});

const { flushPending, reversible, undoable, useHiddenStore } = await import("@/lib/undo");
const { toast } = await import("sonner");

const last = () => shown.at(-1)!;
const tick = () => new Promise((r) => setTimeout(r, 0));

function deleteSpy(fail = false) {
  const calls = { apply: 0, revert: 0, commit: 0, done: 0 };
  undoable({
    message: "Deleted “x”",
    apply: () => calls.apply++,
    revert: () => calls.revert++,
    commit: async () => {
      calls.commit++;
      if (fail) throw new Error("nope");
    },
    done: () => calls.done++,
  });
  return calls;
}

beforeEach(() => {
  shown.length = 0;
  vi.mocked(toast.error).mockClear();
});

describe("undoable", () => {
  it("changes the page at once and sends the request once, when the toast closes", async () => {
    const c = deleteSpy();
    expect(c).toEqual({ apply: 1, revert: 0, commit: 0, done: 0 });
    last().onAutoClose!();
    last().onDismiss!();
    await tick();
    expect(c).toEqual({ apply: 1, revert: 0, commit: 1, done: 1 });
  });

  it("Undo puts it back and the request never goes", async () => {
    const c = deleteSpy();
    last().action!.onClick();
    last().onAutoClose!();
    await flushPending();
    expect(c).toEqual({ apply: 1, revert: 1, commit: 0, done: 0 });
  });

  it("a failed request puts it back and says why", async () => {
    const c = deleteSpy(true);
    last().onDismiss!();
    await tick();
    expect(c.revert).toBe(1);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("closing the window sends whatever is still waiting", async () => {
    const a = deleteSpy();
    const b = deleteSpy();
    await flushPending();
    expect([a.commit, b.commit]).toEqual([1, 1]);
  });
});

describe("reversible", () => {
  it("runs now, and Undo runs the inverse with the result", async () => {
    const undo = vi.fn(async () => {});
    const open = vi.fn();
    const book = await reversible({
      run: async () => ({ id: "b1" }),
      message: "Added",
      undo,
      open: { label: "Open", onClick: open },
    });
    expect(book).toEqual({ id: "b1" });
    last().action!.onClick();
    expect(open).toHaveBeenCalledWith({ id: "b1" });
    last().cancel!.onClick();
    last().cancel!.onClick();
    await tick();
    expect(undo).toHaveBeenCalledOnce();
    expect(undo).toHaveBeenCalledWith({ id: "b1" });
  });
});

describe("hidden items", () => {
  it("hides and shows by kind and id", () => {
    const s = useHiddenStore.getState();
    s.hide("sound", "a");
    s.hide("voice", "a");
    expect(Object.keys(useHiddenStore.getState().ids).sort()).toEqual(["sound:a", "voice:a"]);
    useHiddenStore.getState().show("sound", "a");
    expect(Object.keys(useHiddenStore.getState().ids)).toEqual(["voice:a"]);
  });
});
