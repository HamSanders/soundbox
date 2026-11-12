/**
 * A video on the public site: poster first, plays on click, with a caption.
 *
 * Every clip here is about sound, so none of them autoplays. A muted loop of a
 * product whose whole point is what it sounds like shows the wrong half of it,
 * and a click-to-play clip needs no reduced-motion fallback because nothing
 * moves until someone asks it to. `preload="none"` keeps the page weight at the
 * poster: the MP4 is fetched only when it is played.
 *
 * The files live in `site/public/media/` (posters in `media/posters/`), so they
 * are served by the site build only. Paths go through `assetUrl` for the
 * `/soundbox/` base on GitHub Pages.
 */

import { assetUrl } from "@/lib/asset-url";
import { cn } from "@/lib/utils";

export interface SiteVideoProps {
  /** Root-relative path under the site's public dir, e.g. "/media/launch.mp4". */
  src: string;
  poster: string;
  /** What the clip shows, for anyone who cannot see it. */
  label: string;
  /** Shown under the frame. Omit for clips whose surrounding text says it. */
  caption?: React.ReactNode;
  /** Frame shape. Every launch cut is 16:9 or 1:1. */
  aspect?: "video" | "square";
  className?: string;
}

export function SiteVideo({
  src,
  poster,
  label,
  caption,
  aspect = "video",
  className,
}: SiteVideoProps) {
  return (
    <figure className={cn("min-w-0", className)}>
      <div className="border-border/60 overflow-hidden rounded-xl border bg-dusk shadow-sm">
        <video
          controls
          playsInline
          preload="none"
          poster={assetUrl(poster)}
          aria-label={label}
          width={aspect === "square" ? 1080 : 1920}
          height={1080}
          className={cn(
            "block w-full bg-dusk object-cover",
            aspect === "square" ? "aspect-square" : "aspect-video",
          )}
        >
          <source src={assetUrl(src)} type="video/mp4" />
          <a href={assetUrl(src)}>Download the video</a>
        </video>
      </div>
      {caption && (
        <figcaption className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
