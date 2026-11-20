/**
 * Render only the rows near the viewport of a scrolling list.
 *
 * A 400-paragraph chapter is 20,000 DOM nodes mounted at once, and every
 * selection change re-renders the lot. This keeps about a screen and a half
 * mounted. Rows are variable height (paragraphs wrap), so each mounted row is
 * measured with one shared ResizeObserver and unmeasured rows use an
 * estimate; spacers above and below keep the scrollbar honest.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RefObject } from "react";

export interface WindowedList {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  /** Ref callback for a row; pass the row's key. */
  measure: (key: string) => (node: HTMLElement | null) => void;
  /** Scroll just enough to bring row `index` into view. */
  scrollToIndex: (index: number) => void;
}

export function useWindowedList({
  keys,
  scrollRef,
  estimate = 92,
  overscan = 8,
  keep = null,
}: {
  keys: string[];
  scrollRef: RefObject<HTMLElement | null>;
  estimate?: number;
  overscan?: number;
  /** An index that must stay mounted (the row being edited). */
  keep?: number | null;
}): WindowedList {
  const heights = useRef(new Map<string, number>());
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [view, setView] = useState({ top: 0, height: 800 });

  const offsets = useMemo(() => {
    const o = new Array<number>(keys.length + 1);
    o[0] = 0;
    for (let i = 0; i < keys.length; i++) o[i + 1] = o[i]! + (heights.current.get(keys[i]!) ?? estimate);
    return o;
    // `version` invalidates when a measured height changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, estimate, version]);

  // Track the viewport.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () =>
      setView((v) =>
        v.top === el.scrollTop && v.height === el.clientHeight
          ? v
          : { top: el.scrollTop, height: el.clientHeight },
      );
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [scrollRef]);

  // One observer for every mounted row.
  const observer = useRef<ResizeObserver | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.windowKey;
        if (!key) continue;
        const h = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        if (h > 0 && heights.current.get(key) !== h) {
          heights.current.set(key, h);
          changed = true;
        }
      }
      if (changed && !pending.current) {
        pending.current = true;
        queueMicrotask(() => {
          pending.current = false;
          bump();
        });
      }
    });
    return () => observer.current?.disconnect();
  }, []);

  const refs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const nodes = useRef(new Map<string, HTMLElement>());
  const measure = useCallback((key: string) => {
    let fn = refs.current.get(key);
    if (!fn) {
      fn = (node: HTMLElement | null) => {
        const old = nodes.current.get(key);
        if (old && old !== node) observer.current?.unobserve(old);
        if (node) {
          node.dataset.windowKey = key;
          nodes.current.set(key, node);
          observer.current?.observe(node);
        } else {
          nodes.current.delete(key);
        }
      };
      refs.current.set(key, fn);
    }
    return fn;
  }, []);

  // First row whose bottom is below `y`.
  const find = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = keys.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1]! <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [keys.length, offsets],
  );

  let start = Math.max(0, find(view.top) - overscan);
  let end = Math.min(keys.length, find(view.top + view.height) + 1 + overscan);
  if (keep !== null && keep >= 0 && keep < keys.length) {
    start = Math.min(start, keep);
    end = Math.max(end, keep + 1);
  }

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el || index < 0 || index >= keys.length) return;
      const top = offsets[index]!;
      const bottom = offsets[index + 1]!;
      const margin = 8;
      if (top < el.scrollTop) el.scrollTop = Math.max(0, top - margin);
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + margin;
    },
    [keys.length, offsets, scrollRef],
  );

  return {
    start,
    end,
    padTop: offsets[start] ?? 0,
    padBottom: (offsets[keys.length] ?? 0) - (offsets[end] ?? 0),
    measure,
    scrollToIndex,
  };
}
