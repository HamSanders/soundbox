/**
 * `/models/:slug` — the per-model page.
 *
 * One template renders all 46 models; everything that differs is in
 * `@/content/models/models.ts`, so a corrected licence is a content commit
 * and the template improves for every model at once.
 *
 * Two things this page is deliberately built around:
 *
 * 1. **There is no install command.** The old template had one per model —
 *    `uv sync --extra ...`, a virtualenv, a torch pin. On the audio.cpp path
 *    there is one binary for everything and a `pull` by catalog id, so the
 *    install section is the same three lines for every model and belongs to
 *    the engine rather than to the model.
 * 2. **The licence section is the point of the page.** It sits above the
 *    specs, not below them, and it separates what the weights permit from
 *    what you may do with the audio — see `components/models-license.tsx`.
 *
 * Prerendered with no backend: no react-query hooks, no `Date.now()`, no
 * `Math.random()` at render time.
 */

import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRightIcon, ExternalLinkIcon, TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/docs-primitives";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead, breadcrumbJsonLd } from "@/components/seo-head";
import { AUDIOCPP_REPO, ModelsLicenceNote, RESEARCH_DATE } from "@/components/models-disclaimer";
import { ModelsLicenseChip, ModelsLicensePanel } from "@/components/models-license";
import { CATEGORY_LABEL, ModelMonogram } from "@/components/models-list";
import { MODELS, getModel } from "@/content/models/models";
import type { ModelCapability, ModelContent } from "@/content/models/types";
import { MODELS_HUB_HREF, REPO_URL, WELCOME_HREF } from "@/lib/marketing-links";


const CAPABILITY_LABEL: Record<ModelCapability, string> = {
  generation: "Generation",
  lyrics: "Lyrics",
  separation: "Separation",
  extend: "Extend",
  cover: "Cover",
  repaint: "Repaint",
  tts: "Text to speech",
  "voice-conversion": "Voice conversion",
};

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="border-border/60 border-t py-12">
      <h2
        id={id}
        className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl"
      >
        {title}
      </h2>
      {lede && <p className="text-muted-foreground mt-2 max-w-2xl leading-relaxed">{lede}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-border/60 flex items-start justify-between gap-4 border-b py-2.5 text-sm last:border-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
    </div>
  );
}

function ModelBody({ model }: { model: ModelContent }) {
  // Siblings by category rather than "all the others": with 46 models, a flat
  // list of 45 buttons is noise. Same loader family first — that is the set a
  // reader is actually choosing between.
  const family = MODELS.filter(
    (other) => other.slug !== model.slug && other.spec.family === model.spec.family,
  );
  const sameCategory = MODELS.filter(
    (other) =>
      other.slug !== model.slug &&
      other.category === model.category &&
      other.spec.family !== model.spec.family,
  ).slice(0, 8);

  const pullCommand = `soundbox pull ${model.catalogId}`;

  return (
    <>
      <SeoHead
        title={model.metaTitle}
        description={model.metaDescription}
        path={`/models/${model.slug}`}
        jsonLd={[
          breadcrumbJsonLd([
            { name: "Models", path: "/models" },
            { name: model.name, path: `/models/${model.slug}` },
          ]),
        ]}
      />

      <nav aria-label="Breadcrumb" className="text-muted-foreground pt-8 text-sm">
        <Link
          to={MODELS_HUB_HREF}
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          Models
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{model.name}</span>
      </nav>

      <header className="py-8">
        <div className="flex items-start gap-4">
          {/* A monogram, not a logo. See models-disclaimer.tsx for why we do
              not put vendor marks on a page that disclaims any connection to
              those vendors. */}
          <ModelMonogram name={model.name} className="size-12 rounded-xl text-base" />
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">
              {model.vendor} · {CATEGORY_LABEL[model.category]}
            </p>
            <h1 className="font-heading mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {model.name}
            </h1>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ModelsLicenseChip license={model.license} />
          <span className="text-muted-foreground text-xs">{model.license.name}</span>
        </div>

        <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
          {model.distinctiveness}
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {model.sources[0] && (
            <Button variant="outline" asChild>
              <a href={model.sources[0].href} target="_blank" rel="noreferrer noopener">
                {model.sources[0].label}
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href={AUDIOCPP_REPO} target="_blank" rel="noreferrer noopener">
              audio.cpp
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
        </div>
      </header>

      {/* Licence first. On a page about somebody else's weights it is the
          fact with consequences, and burying it under a specs table would be
          a choice about what gets read. */}
      <Section
        id="license"
        title="The licence"
        lede={`Summarized from the linked source documents, last checked ${RESEARCH_DATE}. Every claim links to its source; anything unconfirmed is marked unconfirmed.`}
      >
        <div className="max-w-2xl">
          <ModelsLicensePanel license={model.license} />
        </div>
      </Section>

      <Section
        id="specs"
        title="Specs"
        lede="Transcribed from the shipped catalog, audiocpp_models_catalog.json — that file is authoritative if a number here disagrees with it."
      >
        <dl className="bg-card/80 ring-border/60 max-w-xl rounded-2xl p-5 ring-1">
          <SpecRow label="Vendor" value={model.spec.vendor} />
          <SpecRow
            label="Catalog id"
            value={<code className="font-mono text-xs">{model.catalogId}</code>}
          />
          <SpecRow
            label="audio.cpp loader family"
            value={<code className="font-mono text-xs">{model.spec.family}</code>}
          />
          <SpecRow
            label="Can do"
            value={model.capabilities.map((c) => CAPABILITY_LABEL[c]).join(", ")}
          />
          <SpecRow
            label="Weights repo"
            value={
              <a
                href={`https://huggingface.co/${model.spec.hfRepo}`}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-primary underline-offset-4 hover:underline"
              >
                {model.spec.hfRepo}
              </a>
            }
          />
          <SpecRow
            label={model.spec.weightsGlob.length > 1 ? "Weights (a package)" : "Weights file"}
            value={
              <span className="font-mono text-xs break-all">
                {model.spec.weightsGlob.join(", ")}
              </span>
            }
          />
          <SpecRow
            label="Account needed to download"
            value={
              model.license.gated === "yes"
                ? "Yes: accept the terms with your own Hugging Face account"
                : model.license.gated === "no"
                  ? "No"
                  : "Could not be confirmed"
            }
          />
          <SpecRow label="Max clip length" value={`${model.spec.maxDurationS}s`} />
          <SpecRow
            label="Sample rate"
            value={`${(model.spec.sampleRate / 1000).toFixed(1)}kHz ${model.spec.channels === 2 ? "stereo" : "mono"}`}
          />
          <SpecRow
            label="Approx. VRAM"
            value={`${(model.spec.vramEstimateMb / 1000).toFixed(1)} GB`}
          />
          {model.downloadSize && <SpecRow label="Download" value={model.downloadSize} />}
          <SpecRow
            label="In the picker by default"
            value={model.tier === "listed" ? "Yes" : "No — opt in from Settings"}
          />
          <SpecRow
            label="Run end-to-end here"
            value={model.verified ? "Yes" : "No — catalogued, not tested here"}
          />
        </dl>
      </Section>

      <Section
        id="install"
        title="Getting it"
        lede="There is no per-model install. One native binary runs all of these, so getting a model is a download of its weights and nothing else — no virtualenv, no torch pin, no CUDA wheel to match against your driver."
      >
        <div className="bg-muted/50 ring-border max-w-2xl min-w-0 overflow-hidden rounded-xl ring-1 ring-inset">
          <div className="text-muted-foreground border-border/60 flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs font-medium">
            <span className="flex items-center gap-2">
              <TerminalIcon className="size-3.5 shrink-0" aria-hidden="true" />
              From the CLI
            </span>
            <CopyButton value={pullCommand} label="Copy command" />
          </div>
          <pre className="overflow-x-auto px-3 py-3 text-xs leading-relaxed">
            <code className="font-mono">{`soundbox model install audiocpp\n${pullCommand}`}</code>
          </pre>
        </div>
        <ul className="text-muted-foreground mt-4 max-w-2xl list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            The binary is fetched from audio.cpp's GitHub releases the first time you ask for it
            and cached under your own data directory. Soundbox ships no native binaries and
            vendors none.
          </li>
          <li>
            Weights land in <code className="font-mono text-xs">&lt;models dir&gt;/audiocpp/{model.catalogId}/</code>{" "}
            rather than in the shared Hugging Face cache, so a download stays scoped to the model
            you asked for.
          </li>
          {model.tier === "extra" && (
            <li>
              This one is opt-in: switch it on in the Models page's &ldquo;Enable more
              models&rdquo; section before it appears in the picker.
            </li>
          )}
          {model.license.gated === "yes" && (
            <li>
              The download is gated. Accept the terms on your own Hugging Face account and add an
              access token in Settings first. Soundbox cannot accept terms on your behalf.
            </li>
          )}
        </ul>
      </Section>

      {model.quirks.length > 0 && (
        <Section id="quirks" title="Worth knowing">
          <ul className="text-muted-foreground max-w-2xl list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {model.quirks.map((quirk) => (
              <li key={quirk}>{quirk}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        id="sources"
        title="Sources"
        lede="Primary sources: the model's own repository, the project it came from, and the conversion audio.cpp actually downloads. Never invented — an entry with nothing findable says so instead."
      >
        <ul className="max-w-2xl space-y-2">
          {model.sources.map((source) => (
            <li key={source.href}>
              <a
                href={source.href}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-primary inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
              >
                {source.label}
                <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
              </a>
            </li>
          ))}
          <li>
            <a
              href={`${REPO_URL}/blob/main/docs/AUDIOCPP.md`}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-primary inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
            >
              How Soundbox drives audio.cpp, including the catalog format
              <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </Section>

      {/* One line of licence hygiene rather than a titled section: the detail
          page's own licence block above already carries the dates, sources and
          corrections, so a second section restating it in the first person was
          the site talking about itself. */}
      <div className="border-border/60 mx-auto max-w-2xl border-t pt-6">
        <ModelsLicenceNote />
      </div>

      {(family.length > 0 || sameCategory.length > 0) && (
        <Section id="related" title="Related models">
          {family.length > 0 && (
            <>
              <h3 className="label-caps text-muted-foreground">
                Same loader family ({model.spec.family})
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {family.map((other) => (
                  <li key={other.slug}>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`${MODELS_HUB_HREF}/${other.slug}`}>{other.name}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sameCategory.length > 0 && (
            <>
              <h3 className="label-caps text-muted-foreground mt-6">
                Other {CATEGORY_LABEL[model.category].toLowerCase()} models
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {sameCategory.map((other) => (
                  <li key={other.slug}>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`${MODELS_HUB_HREF}/${other.slug}`}>{other.name}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      <Separator />
      <footer className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 py-8 text-sm">
        <Link to={MODELS_HUB_HREF} className="hover:text-foreground inline-flex items-center gap-1">
          All models
          <ArrowRightIcon className="size-3.5" aria-hidden="true" />
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="hover:text-foreground">
          GitHub
        </a>
        <MarketingLink href={WELCOME_HREF} className="hover:text-foreground">
          What Soundbox is
        </MarketingLink>
      </footer>
    </>
  );
}

export function ModelsDetailPage() {
  const { slug } = useParams();
  const model = getModel(slug);

  if (!model) {
    return <Navigate to={MODELS_HUB_HREF} replace />;
  }

  return (
    <div className="bg-background text-foreground min-h-svh">
      <div className="mx-auto w-full max-w-3xl px-4">
        <ModelBody model={model} />
      </div>
    </div>
  );
}
