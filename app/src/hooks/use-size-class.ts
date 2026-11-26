import * as React from "react";

/**
 * The window's width class, after Android's: compact under 600px, medium
 * 600 to 839px, expanded from 840px
 * (https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes).
 * The shell lays out by these rather than by device: compact gets the bottom
 * tab bar, medium the labelled rail, expanded the sidebar. The same numbers
 * are the `medium:` and `expanded:` Tailwind breakpoints in index.css.
 */
export type SizeClass = "compact" | "medium" | "expanded";

const MEDIUM_MIN = 600;
const EXPANDED_MIN = 840;

function current(): SizeClass {
  const w = window.innerWidth;
  return w < MEDIUM_MIN ? "compact" : w < EXPANDED_MIN ? "medium" : "expanded";
}

export function useSizeClass(): SizeClass {
  const [size, setSize] = React.useState<SizeClass>(() =>
    typeof window === "undefined" ? "expanded" : current(),
  );
  React.useEffect(() => {
    const queries = [MEDIUM_MIN, EXPANDED_MIN].map((px) => window.matchMedia(`(min-width: ${px}px)`));
    const onChange = () => setSize(current());
    queries.forEach((q) => q.addEventListener("change", onChange));
    onChange();
    return () => queries.forEach((q) => q.removeEventListener("change", onChange));
  }, []);
  return size;
}
