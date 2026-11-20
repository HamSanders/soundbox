/**
 * The editor's one polite live region. Repeating the same text still
 * announces, because the region's content is a new node each time.
 */

import { useAnnouncer } from "./announce";

/** Render once per page. Visually hidden. */
export function LiveRegion() {
  const message = useAnnouncer((s) => s.message);
  const seq = useAnnouncer((s) => s.seq);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      <span key={seq}>{message}</span>
    </div>
  );
}
