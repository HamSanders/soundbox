/**
 * The disclaimer that appears on every `/models` page, and the short
 * explainer of what audio.cpp is.
 *
 * These two live in one file because they are one argument. Konchi is a
 * *sourcing* layer: it points audio.cpp at weights on Hugging Face that you
 * download, under your own account, from people we have nothing to do with.
 * Everything on these pages — the specs, the licences, the "verified" marks —
 * is our reading of somebody else's work, and our reading can be wrong or
 * out of date. Saying that once, plainly, in the same voice as the rest of
 * the site, beats scattering asterisks.
 *
 * The deliberate omission here is **logos**. No Stability, Alibaba, Microsoft
 * or MiniMax marks appear anywhere on these pages, and that is a decision
 * rather than a to-do:
 *
 *   - A vendor's mark on a page is read as that vendor's involvement in it.
 *     That directly contradicts the paragraph below, and the disclaimer is
 *     the more important of the two.
 *   - The site is prerendered and self-contained. Hotlinking a logo adds a
 *     third-party request to a static page and a trademark question to a
 *     repo that has neither.
 *
 * Models get a monogram tile instead (see `models-list.tsx`), the same
 * two-letter fallback `routes/sfx/hub.tsx` uses for a category without art.
 */

import { CpuIcon, ExternalLinkIcon } from "lucide-react";

import { REPO_URL } from "@/lib/marketing-links";

export const AUDIOCPP_REPO = "https://github.com/0xShug0/audio.cpp";
export const AUDIOCPP_GGUF_REPO = "https://huggingface.co/audio-cpp/audio.cpp-gguf";
const KONCHI_REPO = REPO_URL;

/**
 * Where these pages' facts come from, as a date. Licences change; a page that
 * does not say when it was written is asking to be believed indefinitely.
 *
 * A constant, not `new Date()`: these pages are prerendered, and a render-time
 * clock is a hydration mismatch waiting to happen.
 */
export const RESEARCH_DATE = "25 August 2026";

/** What audio.cpp is, and the one consequence of it that a reader actually
 *  feels: no Python, no per-model environment. Facts from docs/AUDIOCPP.md and
 *  audio.cpp's own README (read 2026-08-25). */
export function ModelsEngineNote() {
  return (
    <div className="bg-card/80 ring-border/60 rounded-2xl p-5 ring-1">
      <div className="flex items-center gap-2">
        <CpuIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <h2 className="font-heading text-base font-semibold tracking-tight">
          Every model here runs through audio.cpp
        </h2>
      </div>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        <a
          href={AUDIOCPP_REPO}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-foreground underline underline-offset-4"
        >
          audio.cpp
        </a>{" "}
        is a ggml-based C++ inference engine — the audio equivalent of llama.cpp — with CUDA,
        HIP/ROCm, Metal, Vulkan and CPU backends. It is Apache-2.0 licensed, an independent
        project that Konchi builds on.
      </p>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        The practical consequence is the whole reason this list looks the way it does:{" "}
        <span className="text-foreground font-medium">there is no Python in the inference path</span>
        . No per-model torch pin, no virtualenv per model, no CUDA wheel to match against your
        driver. One native binary, one quantised GGUF file per model, and adding a model is a
        catalog entry rather than a new dependency tree. That is why a list this long is
        maintainable at all.
      </p>
      <ul className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        <li>
          <a
            href={AUDIOCPP_REPO}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-4"
          >
            audio.cpp on GitHub
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </li>
        <li>
          <a
            href={AUDIOCPP_GGUF_REPO}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-4"
          >
            The GGUF conversions on Hugging Face
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </li>
        <li>
          <a
            href={`${KONCHI_REPO}/blob/main/docs/AUDIOCPP.md`}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-4"
          >
            How Konchi drives it
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </div>
  );
}

/**
 * One line of licence hygiene, replacing what used to be a three-paragraph
 * first-person disclaimer ("These are our findings…"). That block read as the
 * site talking to the reader about itself, which is the one register a
 * production page must not have — the facts it carried survive here in the
 * third person, and the per-model pages carry the detail (dates, sources,
 * corrections) where it is actually load-bearing.
 */
export function ModelsLicenceNote() {
  return (
    <p className="text-muted-foreground text-xs leading-relaxed">
      Licence details on these pages are summaries of the linked source documents, last checked{" "}
      {RESEARCH_DATE}. They are not legal advice, and Konchi is not affiliated with any model's
      authors — weights download from Hugging Face under the user's own account and terms.
      Company and model names identify whose work it is, and belong to their owners. The linked
      licence text is authoritative; commercial use should be checked against it, per model,
      before anything ships.
    </p>
  );
}
