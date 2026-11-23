/**
 * A titled row of covers that pages sideways, the way shelf rows do in
 * Audible, Libby and ElevenReader: arrow buttons by the title move it a
 * screen at a time, and there's no scrollbar. It still scrolls by trackpad,
 * touch and Shift+wheel, and the arrows hide when everything fits.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CoverRow({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
  };
  const fits = edges.start && edges.end;

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-muted-foreground text-xs">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {!fits && (
            <>
              <Button variant="outline" size="icon-xs" className="rounded-full" aria-label={`Scroll ${title} back`} disabled={edges.start} onClick={() => page(-1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="icon-xs" className="rounded-full" aria-label={`Scroll ${title} on`} disabled={edges.end} onClick={() => page(1)}>
                <ChevronRightIcon />
              </Button>
            </>
          )}
        </div>
      </div>
      <div
        ref={ref}
        onScroll={measure}
        className="-mx-1 flex snap-x gap-4 overflow-x-auto scroll-smooth px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </section>
  );
}
